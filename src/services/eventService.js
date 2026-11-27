const { withTransaction } = require('../config/mongodb');
const notifications = require('./notificationService');
const { ObjectId } = require('mongodb');
const repository = require('../repositories/eventRepository');
const categories = require('../repositories/categoryRepository');

const { AppError } = require('../utils/errors');

const {
    objectIdSchema,
    eventSchema,
    updateEventSchema,
    validate
} = require('../utils/validations');

async function createEvent(body) {
    const data = validate(eventSchema, body);

    if (!await categories.exists(data.categoryId)) {
        throw new AppError('La categoría no existe', 404);
    }

    const event = {
        ...data,
        categoryId: new ObjectId(data.categoryId),
        date: new Date(data.date),
        status: 'DRAFT',

        ticketTypes: data.ticketTypes.map(ticket => ({
            _id: new ObjectId(),
            name: ticket.name,
            price: ticket.price,
            capacity: ticket.capacity,
            available: ticket.capacity
        })),

        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date()
    };

    return repository.create(event);
}

async function getEvent(id) {
    validate(objectIdSchema, id);

    const event = await repository.findById(id);

    if (!event) {
        throw new AppError('Evento no encontrado', 404);
    }

    return event;
}

async function updateEvent(id, body) {
    validate(objectIdSchema, id);

    const data = validate(updateEventSchema, body);
    if (data.categoryId) {
        if (!await categories.exists(data.categoryId)) {
            throw new AppError('La categoría no existe', 404);
        }

        data.categoryId = new ObjectId(data.categoryId);
    }

    if (data.date) {
        data.date = new Date(data.date);
    }

    return withTransaction(async session => {
        const event = await repository.findById(id, session);
        if (!event) throw new AppError('Evento no encontrado', 404);

        if (['CANCELLED', 'COMPLETED'].includes(event.status)) {
            throw new AppError(
                'No se puede modificar un evento finalizado o cancelado',
                409
            );
        }

        if (data.status === 'COMPLETED' &&
            event.status !== 'PUBLISHED') {
            throw new AppError(
                'Solo se puede completar un evento publicado',
                409
            );
        }

        const updated = await repository.update(id, data, {}, session);
        const changedFields = Object.keys(data).filter(field =>
            JSON.stringify(event[field]) !== JSON.stringify(updated[field])
        );
        await notifications.onEventChange(event, updated, changedFields, session);
        return updated;
    });
}

async function deleteEvent(id) {
    validate(objectIdSchema, id);
    return withTransaction(async session => {
        const event = await repository.findById(id, session);
        if (!event) throw new AppError('Evento no encontrado', 404);

        const deleted = await repository.update(id, {
            isDeleted: true, deletedAt: new Date()
        }, {}, session);
        await notifications.onEventChange(event, deleted, ['isDeleted'], session);
        return deleted;
    });
}

async function publishEvent(id) {
    const event = await getEvent(id);

    if (event.status !== 'DRAFT') {
        throw new AppError('Solo se puede publicar un evento en borrador', 409);
    }

    const { title, description, location, categoryId, date, ticketTypes } = event;
    validate(eventSchema, {
        title,
        description,
        location,
        categoryId: categoryId?.toString(),
        date: date instanceof Date ? date.toJSON() : date,
        ticketTypes
    });

    if (new Date(date) <= new Date()) {
        throw new AppError('La fecha del evento debe estar en el futuro', 409);
    }

    if (!await categories.exists(categoryId)) {
        throw new AppError('La categoría no existe', 404);
    }

    // Comprueba los campos validados antes de publicar para evitar carreras con las ediciones.
    const now = new Date();
    const published = await repository.update(id, {
        status: 'PUBLISHED',
        publishedAt: now
    }, {
        status: 'DRAFT',
        title,
        description,
        location,
        categoryId,
        date: { $eq: date, $gt: now },
        ticketTypes
    });

    if (!published) {
        throw new AppError('El evento cambió o su fecha venció durante la publicación', 409);
    }

    return published;
}

async function listEvents(query = {}) {
    const filter = {
        isDeleted: false
    };

    const statuses = [
        'DRAFT',
        'PUBLISHED',
        'CANCELLED',
        'COMPLETED'
    ];

    if (query.status) {
        if (!statuses.includes(query.status)) {
            throw new AppError('Estado inválido', 400);
        }

        filter.status = query.status;
    }

    if (query.categoryId) {
        validate(objectIdSchema, query.categoryId);
        filter.categoryId = new ObjectId(query.categoryId);
    }

    if (query.search) {
        const search = query.search.trim();

        if (search.length > 100) {
            throw new AppError('Búsqueda demasiado larga', 400);
        }

        const escaped = search.replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
        );

        filter.$or = [
            { title: { $regex: escaped, $options: 'i' } },
            { description: { $regex: escaped, $options: 'i' } },
            { location: { $regex: escaped, $options: 'i' } }
        ];
    }

    const order = query.order || 'desc';

    if (!['asc', 'desc'].includes(order)) {
        throw new AppError('Orden inválido', 400);
    }

    const direction = order === 'asc' ? 1 : -1;

    const limit = Number(query.limit ?? 10);

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new AppError(
            'El límite debe estar entre 1 y 100',
            400
        );
    }

    if (query.cursor) {
        validate(objectIdSchema, query.cursor);

        filter._id = direction === 1
            ? { $gt: new ObjectId(query.cursor) }
            : { $lt: new ObjectId(query.cursor) };
    }

    const events = await repository.findAll(
        filter,
        { _id: direction },
        limit + 1
    );

    const hasMore = events.length > limit;

    if (hasMore) {
        events.pop();
    }

    return {
        events,
        pagination: {
            limit,
            hasMore,
            nextCursor: hasMore
                ? events[events.length - 1]._id.toString()
                : null
        }
    };
}

module.exports = {
    createEvent,
    getEvent,
    updateEvent,
    deleteEvent,
    publishEvent,
    listEvents
};