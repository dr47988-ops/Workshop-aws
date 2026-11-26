const { ObjectId } = require('mongodb');
const repository = require('../repositories/eventRepository');

const { AppError } = require('../utils/errors');

const {
    objectIdSchema,
    eventSchema,
    updateEventSchema,
    validate
} = require('../utils/validations');

async function createEvent(body) {
    const data = validate(eventSchema, body);

    if (!await repository.categoryExists(data.categoryId)) {
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
    const event = await getEvent(id);

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

    if (data.categoryId) {
        if (!await repository.categoryExists(data.categoryId)) {
            throw new AppError('La categoría no existe', 404);
        }

        data.categoryId = new ObjectId(data.categoryId);
    }

    if (data.date) {
        data.date = new Date(data.date);
    }

    const updated = await repository.update(
        id,
        data,
        event.status
    );

    if (!updated) {
        throw new AppError(
            'El evento cambió durante la actualización',
            409
        );
    }

    return updated;
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
    listEvents
};