const { ObjectId } = require('mongodb');
const { withTransaction } = require('../config/mongodb');
const { createHash } = require('node:crypto');
const events = require('../repositories/eventRepository');
const repository = require('../repositories/reservationRepository');
const { AppError } = require('../utils/errors');
const { taxRate, reservationTtlMinutes } = require('../config/settings');

const {
    objectIdSchema,
    reservationSchema,
    validate
} = require('../utils/validations');

const statuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED'];

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

async function createReservation(eventId, userId, body, key) {
    validate(objectIdSchema, eventId);
    const { items } = validate(reservationSchema, body);
    if (key !== undefined && (typeof key !== 'string' || !/^[!-~]{1,128}$/.test(key))) {
        throw new AppError('Idempotency-Key inválida', 400);
    }

    const user = new ObjectId(userId);
    const id = new ObjectId(eventId);
    const normalized = items.map(({ ticketTypeId, quantity }) => ({
        ticketTypeId: ticketTypeId.toLowerCase(), quantity
    }));
    const canonical = [...normalized].sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId));
    const hash = createHash('sha256').update(JSON.stringify([id, canonical])).digest('hex');
    const scope = key === undefined ? null : { userId: user, idempotencyKey: key };

    function replay(existing) {
        if (existing.requestHash !== hash) {
            throw new AppError('Idempotency-Key ya utilizada para otra solicitud', 409);
        }
        return existing.creationResponse;
    }

    try {
        return await withTransaction(async session => {
            if (scope) {
                const previous = await repository.findOne(scope, session);
                if (previous) return replay(previous);
            }
            const event = await events.findById(id, session);
            if (!event) throw new AppError('Evento no encontrado', 404);
            const now = new Date();
            if (event.status !== 'PUBLISHED' || new Date(event.date) <= now) {
                throw new AppError('El evento no está disponible para reservar', 409);
            }

            const lines = buildLines(event, normalized);
            const active = await repository.findOne({
                eventId: id, userId: user,
                $or: [{ status: 'CONFIRMED' }, { status: 'PENDING', expiresAt: { $gt: now } }]
            }, session);
            if (active) throw new AppError('Ya existe una reservación activa para el evento', 409);

            // La escritura del mismo evento serializa intentos concurrentes.
            for (const line of lines) {
                if (!await events.reserveTickets(id, line.ticketTypeId, line.quantity, session)) {
                    throw new AppError(`No hay suficientes entradas disponibles de ${line.name}`, 409);
                }
            }

            const reservation = {
                _id: new ObjectId(), userId: user, eventId: id, items: lines,
                ...calculateTotals(lines),
                status: 'PENDING',
                expiresAt: new Date(Math.min(
                    now.getTime() + reservationTtlMinutes() * 60000, new Date(event.date).getTime()
                )),
                createdAt: now, updatedAt: now,
                history: [{ from: null, to: 'PENDING', at: now }]
            };
            await repository.create(scope ? {
                ...reservation, idempotencyKey: key, requestHash: hash,
                creationResponse: reservation
            } : reservation, session);
            return reservation;
        });
    } catch (error) {
        if (scope && error.code === 11000) {
            const previous = await repository.findOne(scope);
            if (previous) return replay(previous);
        }
        throw error;
    }
}

function publicReservation({ idempotencyKey, requestHash, creationResponse, ...reservation }) {
    return reservation;
}

async function transition(id, from, to, timestamp, session) {
    const now = new Date();
    const conditions = from !== 'PENDING' ? {} : {
        expiresAt: to === 'EXPIRED' ? { $lte: now } : { $gt: now }
    };
    const changed = await repository.changeStatus(
        id, from, { status: to, [timestamp]: now }, conditions, session
    );
    if (changed && to !== 'CONFIRMED') {
        for (const line of changed.items) {
            if (!await events.releaseTickets(changed.eventId, line.ticketTypeId, line.quantity, session)) {
                throw new AppError('No se pudo liberar el inventario', 409);
            }
        }
    }
    return changed;
}

function expireReservation(id) {
    return withTransaction(session => transition(id, 'PENDING', 'EXPIRED', 'expiredAt', session));
}

async function expireDueReservations(limit = 100, userId) {
    const due = await repository.findExpired(new Date(), limit, userId);
    let count = 0;
    for (const reservation of due) {
        if (await expireReservation(reservation._id)) count++;
    }
    return count;
}

async function getReservation(id, userId) {
    validate(objectIdSchema, id);
    let reservation = await repository.findById(id);
    if (!reservation || !reservation.userId.equals(userId)) {
        throw new AppError('Reservación no encontrada', 404);
    }
    if (reservation.status === 'PENDING' && new Date(reservation.expiresAt) <= new Date()) {
        reservation = await expireReservation(id) || await repository.findById(id);
    }
    return publicReservation(reservation);
}

async function confirmReservation(id, userId) {
    const current = await getReservation(id, userId);
    if (current.status === 'CONFIRMED') return current;
    if (current.status !== 'PENDING') throw new AppError('La reservación ya no se puede confirmar', 409);

    const confirmed = await withTransaction(async session => {
        const event = await events.findById(current.eventId, session);
        if (!event || event.status !== 'PUBLISHED' || new Date(event.date) <= new Date()) {
            throw new AppError('El evento no está disponible para confirmar', 409);
        }
        await events.lockEvent(event._id, session);
        return transition(id, 'PENDING', 'CONFIRMED', 'confirmedAt', session);
    });
    if (confirmed) return publicReservation(confirmed);
    const latest = await getReservation(id, userId);
    if (latest.status === 'CONFIRMED') return latest;
    throw new AppError('La reservación ya no se puede confirmar', 409);
}

async function cancelReservation(id, userId) {
    const current = await getReservation(id, userId);
    if (!['PENDING', 'CONFIRMED'].includes(current.status)) {
        throw new AppError('La reservación ya no se puede cancelar', 409);
    }
    const cancelled = await withTransaction(session =>
        transition(id, current.status, 'CANCELLED', 'cancelledAt', session)
    );
    if (!cancelled) {
        await getReservation(id, userId);
        throw new AppError('La reservación cambió de estado, intente de nuevo', 409);
    }
    return publicReservation(cancelled);
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
        reservations: reservations.map(publicReservation),
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
    confirmReservation,
    listUserReservations,
    expireDueReservations
};
