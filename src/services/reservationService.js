const { ObjectId } = require('mongodb');
const events = require('../repositories/eventRepository');
const repository = require('../repositories/reservationRepository');
const { AppError } = require('../utils/errors');
const { taxRate, reservationTtlMinutes } = require('../config/settings');

const {
    objectIdSchema,
    reservationSchema,
    validate
} = require('../utils/validations');

const statuses = ['PENDING', 'CANCELLED', 'EXPIRED'];

// Los montos se calculan en centavos para evitar errores de decimales.
const toCents = amount => Math.round(amount * 100);
const fromCents = cents => cents / 100;

function buildLines(event, items) {
    const seen = new Set();

    return items.map(item => {
        if (seen.has(item.ticketTypeId)) {
            throw new AppError('Hay tipos de entrada repetidos', 400);
        }

        seen.add(item.ticketTypeId);

        const ticket = event.ticketTypes.find(
            type => type._id.toString() === item.ticketTypeId
        );

        if (!ticket) {
            throw new AppError('El tipo de entrada no existe en el evento', 404);
        }

        return {
            ticketTypeId: ticket._id,
            name: ticket.name,
            quantity: item.quantity,
            unitPrice: ticket.price,
            subtotal: fromCents(toCents(ticket.price) * item.quantity)
        };
    });
}

function calculateTotals(lines) {
    const subtotalCents = lines.reduce(
        (sum, line) => sum + toCents(line.subtotal),
        0
    );
    const taxCents = Math.round(subtotalCents * taxRate());

    return {
        subtotal: fromCents(subtotalCents),
        taxRate: taxRate(),
        tax: fromCents(taxCents),
        total: fromCents(subtotalCents + taxCents)
    };
}

async function releaseInventory(reservation) {
    for (const line of reservation.items) {
        await events.releaseTickets(
            reservation.eventId,
            line.ticketTypeId,
            line.quantity
        );
    }
}

async function createReservation(eventId, userId, body) {
    validate(objectIdSchema, eventId);
    const data = validate(reservationSchema, body);

    const event = await events.findById(eventId);

    if (!event) {
        throw new AppError('Evento no encontrado', 404);
    }

    if (event.status !== 'PUBLISHED') {
        throw new AppError('El evento no está disponible para reservar', 409);
    }

    if (new Date(event.date) <= new Date()) {
        throw new AppError('El evento ya pasó', 409);
    }

    const lines = buildLines(event, data.items);
    const taken = [];

    try {
        for (const line of lines) {
            const ok = await events.reserveTickets(
                event._id,
                line.ticketTypeId,
                line.quantity
            );

            if (!ok) {
                throw new AppError(
                    `No hay suficientes entradas disponibles de ${line.name}`,
                    409
                );
            }

            taken.push(line);
        }

        const now = new Date();

        return await repository.create({
            userId: new ObjectId(userId),
            eventId: event._id,
            items: lines,
            ...calculateTotals(lines),
            status: 'PENDING',
            expiresAt: new Date(
                now.getTime() + reservationTtlMinutes() * 60000
            ),
            createdAt: now,
            updatedAt: now
        });
    } catch (error) {
        // Si algo falla a mitad de camino se devuelven las entradas ya tomadas.
        await releaseInventory({ eventId: event._id, items: taken });
        throw error;
    }
}

// Marca la reservación como vencida y devuelve las entradas. Solo libera el
// inventario quien logre el cambio de estado, así nunca se libera dos veces.
async function expireReservation(reservation) {
    const expired = await repository.changeStatus(
        reservation._id,
        'PENDING',
        { status: 'EXPIRED', expiredAt: new Date() }
    );

    if (expired) {
        await releaseInventory(expired);
    }

    return expired || reservation;
}

function isExpired(reservation) {
    return reservation.status === 'PENDING' &&
        new Date(reservation.expiresAt) <= new Date();
}

async function expireDueReservations(limit = 100, userId) {
    const due = await repository.findExpired(new Date(), limit, userId);
    let count = 0;

    for (const reservation of due) {
        if (await repository.changeStatus(
            reservation._id,
            'PENDING',
            { status: 'EXPIRED', expiredAt: new Date() }
        )) {
            await releaseInventory(reservation);
            count++;
        }
    }

    return count;
}

async function getReservation(id, userId) {
    validate(objectIdSchema, id);

    let reservation = await repository.findById(id);

    if (!reservation || !reservation.userId.equals(userId)) {
        throw new AppError('Reservación no encontrada', 404);
    }

    if (isExpired(reservation)) {
        reservation = await expireReservation(reservation);
    }

    return reservation;
}

async function cancelReservation(id, userId) {
    const reservation = await getReservation(id, userId);

    if (reservation.status !== 'PENDING') {
        throw new AppError(
            reservation.status === 'EXPIRED'
                ? 'La reservación ya expiró'
                : 'La reservación ya fue cancelada',
            409
        );
    }

    const cancelled = await repository.changeStatus(
        id,
        'PENDING',
        { status: 'CANCELLED', cancelledAt: new Date() }
    );

    if (!cancelled) {
        throw new AppError('La reservación cambió de estado, intente de nuevo', 409);
    }

    await releaseInventory(cancelled);

    return cancelled;
}

async function listUserReservations(userId, query = {}) {
    // Antes de listar se liberan las reservaciones vencidas de este usuario.
    await expireDueReservations(100, userId);

    const filter = { userId: new ObjectId(userId) };

    if (query.status) {
        if (!statuses.includes(query.status)) {
            throw new AppError('Estado inválido', 400);
        }

        filter.status = query.status;
    }

    const limit = Number(query.limit ?? 10);

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new AppError('El límite debe estar entre 1 y 100', 400);
    }

    if (query.cursor) {
        validate(objectIdSchema, query.cursor);
        filter._id = { $lt: new ObjectId(query.cursor) };
    }

    const reservations = await repository.findByUser(
        filter,
        { _id: -1 },
        limit + 1
    );

    const hasMore = reservations.length > limit;

    if (hasMore) {
        reservations.pop();
    }

    return {
        reservations,
        pagination: {
            limit,
            hasMore,
            nextCursor: hasMore
                ? reservations[reservations.length - 1]._id.toString()
                : null
        }
    };
}

module.exports = {
    createReservation,
    getReservation,
    cancelReservation,
    listUserReservations,
    expireDueReservations
};
