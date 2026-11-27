const { ObjectId } = require('mongodb');
const { z } = require('zod');
const { withTransaction } = require('../config/mongodb');
const events = require('../repositories/eventRepository');
const reservations = require('../repositories/reservationRepository');
const jobs = require('../repositories/notificationRepository');
const { AppError } = require('../utils/errors');
const { objectIdSchema, validate } = require('../utils/validations');

const message = z.string().trim().min(1).max(1000);
const reminder = z.object({ minutesBefore: z.number().int().min(1).max(525600), message }).strict();
const reminderPatch = reminder.partial().refine(data => Object.keys(data).length > 0);
const announcement = z.object({ message }).strict();
const objectId = value => new ObjectId(validate(objectIdSchema, value));

async function findEvent(id, session) {
    const event = await events.findById(id, session);
    if (!event) throw new AppError('Evento no encontrado', 404);
    return event;
}

function schedule(event, minutesBefore) {
    const dueAt = new Date(new Date(event.date).getTime() - minutesBefore * 60000);
    if (dueAt <= new Date()) throw new AppError('El recordatorio debe quedar en el futuro', 409);
    return dueAt;
}

async function create(type, eventId, body) {
    const id = objectId(eventId);
    const data = validate(type === 'REMINDER' ? reminder : announcement, body);
    return withTransaction(async session => {
        const event = await findEvent(id, session);
        const now = new Date();
        if (new Date(event.date) <= now || !['DRAFT', 'PUBLISHED'].includes(event.status) ||
            (type === 'ANNOUNCEMENT' && event.status !== 'PUBLISHED')) {
            throw new AppError('El evento no admite esta notificación', 409);
        }
        await events.lockEvent(event._id, session);
        const dueAt = type === 'REMINDER' ? schedule(event, data.minutesBefore) : now;
        const signature = JSON.stringify([type, data.minutesBefore, data.message]);
        return jobs.create({
            eventId: id, type, ...data, dueAt, signature,
            status: 'PENDING', createdAt: now, updatedAt: now
        }, session);
    });
}

async function list(type, eventId, user) {
    const id = objectId(eventId);
    await findEvent(id);
    if (user.role !== 'ADMIN' && !await reservations.findOne({
        eventId: id, userId: user._id,
        $or: [{ status: 'CONFIRMED' }, { status: 'PENDING', expiresAt: { $gt: new Date() } }]
    })) {
        throw new AppError('Acceso denegado', 403);
    }
    return jobs.list({ eventId: id, type }, { createdAt: -1, _id: -1 }, 100);
}

async function editReminder(id, body, cancel = false) {
    const query = { _id: objectId(id), type: 'REMINDER' };
    const patch = cancel ? {} : validate(reminderPatch, body);

    return withTransaction(async session => {
        const current = await jobs.findOne(query, session);
        if (!current) throw new AppError('Recordatorio no encontrado', 404);
        if (cancel && current.status === 'CANCELLED') return current;
        if (current.status !== 'PENDING') throw new AppError('El recordatorio ya fue procesado', 409);

        const now = new Date();
        if (cancel) {
            return jobs.change(query, {
                $set: { status: 'CANCELLED', updatedAt: now },
                $unset: { signature: '' }
            }, session);
        }

        const event = await findEvent(current.eventId, session);
        await events.lockEvent(event._id, session);
        const minutesBefore = patch.minutesBefore ?? current.minutesBefore;
        const text = patch.message ?? current.message;
        return jobs.change(query, { $set: {
            minutesBefore, message: text, dueAt: schedule(event, minutesBefore),
            signature: JSON.stringify(['REMINDER', minutesBefore, text]), updatedAt: now
        } }, session);
    });
}

async function onEventChange(before, after, changedFields, session) {
    const now = new Date();
    const cancelled = after.isDeleted || after.status === 'CANCELLED';
    const finished = after.status === 'COMPLETED';
    if (cancelled || finished) {
        await jobs.cancelReminders(after._id, session);
    } else if (changedFields.includes('date')) {
        const pending = await jobs.list(
            { eventId: after._id, type: 'REMINDER', status: 'PENDING' },
            { _id: 1 }, 0, session
        );
        for (const job of pending) {
            const dueAt = new Date(Math.max(now.getTime(), new Date(after.date).getTime() - job.minutesBefore * 60000));
            await jobs.change({ _id: job._id }, { $set: { dueAt, updatedAt: now } }, session);
        }
    }

    if (before.status !== 'PUBLISHED' || finished || !changedFields.length) return;
    await jobs.create({
        eventId: after._id, type: cancelled ? 'CANCELLATION' : 'UPDATE',
        message: cancelled ? `Se canceló el evento ${before.title}.`
            : `Se actualizó el evento ${after.title}. Fecha: ${new Date(after.date).toISOString()}. Lugar: ${after.location}.`,
        status: 'PENDING', dueAt: now, createdAt: now, updatedAt: now
    }, session);
}

async function processPending(limit = 25) {
    const now = new Date();
    const candidates = await jobs.list(
        { status: 'PENDING', dueAt: { $lte: now } }, { dueAt: 1, _id: 1 }, limit
    );
    let processed = 0;
    let sent = 0;
    for (const { _id } of candidates) {
        const count = await withTransaction(async session => {
            const filter = { _id, status: 'PENDING', dueAt: { $lte: now } };
            const job = await jobs.findOne(filter, session);
            if (!job) return null;
            const event = await events.findById(job.eventId, session);
            if (job.type !== 'CANCELLATION' &&
                (event?.status !== 'PUBLISHED' || new Date(event.date) <= now)) {
                await jobs.change(filter, {
                    $set: { status: 'CANCELLED', updatedAt: now }, $unset: { signature: '' }
                }, session);
                return 0;
            }
            if (event) await events.lockEvent(event._id, session);
            const users = await reservations.notificationRecipients(job.eventId, now, session);
            await jobs.send(job, users, now, session);
            await jobs.change(filter, { $set: {
                status: 'SENT', sentAt: now, updatedAt: now, recipientCount: users.length
            } }, session);
            return users.length;
        });
        if (count !== null) {
            processed++;
            sent += count;
        }
    }
    return { processed, sent };
}

function history(userId, cursor) {
    return jobs.history(userId, cursor === undefined ? undefined : objectId(cursor));
}

module.exports = { create, list, editReminder, onEventChange, processPending, history };
