const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ObjectId } = require('mongodb');

process.env.DB_NAME = 'workshop_notifications_' + randomUUID().replace(/-/g, '');
process.env.JWT_ACCESS_SECRET = randomUUID();
process.env.JWT_REFRESH_SECRET = randomUUID();
delete process.env.WORKSHOP_LOCAL_LEGACY;

const { connectDB } = require('./src/config/mongodb');
const { registerIndexes } = require('./src/repositories/notificationRepository');
const auth = require('./src/handlers/auth').handler;
const notify = require('./src/handlers/notifications').handler;
const edit = require('./src/handlers/updateEvent').handler;
const expire = require('./src/handlers/expireReservations').handler;
const reserve = require('./src/handlers/createReservation').handler;
const confirm = require('./src/handlers/confirmReservation').handler;

async function call(handler, routeKey, status, { token, id, body, headers } = {}) {
    const result = await handler({
        routeKey,
        pathParameters: id ? { id: id.toString() } : undefined,
        headers: { ...headers, ...(token && { authorization: `Bearer ${token}` }) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = JSON.parse(result.body);
    assert.equal(result.statusCode, status, JSON.stringify(payload));
    return payload.data ?? payload;
}

async function register(db, email, role) {
    const body = { email, name: email, password: 'local-test-password' };
    const user = await call(auth, 'POST /auth/register', 201, { body });
    const id = new ObjectId(user.id);
    await db.collection('users').updateOne({ _id: id }, { $set: { role } });
    const session = await call(auth, 'POST /auth/login', 200, { body: {
        email: body.email, password: body.password
    } });
    return { id, token: session.accessToken };
}

async function test() {
    const db = await connectDB();
    try {
        await registerIndexes(db);
        const admin = await register(db, 'admin@example.com', 'ADMIN');
        const participant = await register(db, 'participant@example.com', 'PARTICIPANT');
        const outsider = await register(db, 'outsider@example.com', 'PARTICIPANT');
        const eventDate = new Date(Date.now() + 86400000);
        const ticketId = new ObjectId();
        const { insertedId: id } = await db.collection('events').insertOne({
            title: 'Evento de prueba', location: 'San José', status: 'PUBLISHED',
            date: eventDate, isDeleted: false,
            ticketTypes: [{ _id: ticketId, name: 'General', price: 1, capacity: 2, available: 2 }]
        });
        const asAdmin = { token: admin.token, id };
        const asParticipant = { token: participant.token, id };
        const jobs = db.collection('notificationJobs');
        const historyRoute = 'GET /users/me/notifications';

        const body = { items: [{ ticketTypeId: String(ticketId), quantity: 1 }] };
        await call(reserve, 'POST /events/{id}/reservations', 401, {
            id, body, headers: { 'x-user-id': String(participant.id) }
        });
        const booking = await call(reserve, 'POST /events/{id}/reservations', 201, {
            ...asParticipant, body
        });
        await call(confirm, 'PATCH /reservations/{id}/confirm', 200, { ...asParticipant, id: booking._id });
        const expiring = await call(reserve, 'POST /events/{id}/reservations', 201, {
            id, token: outsider.token, body
        });
        await db.collection('reservations').updateOne({ _id: new ObjectId(expiring._id) },
            { $set: { expiresAt: new Date(0) } });
        await call(expire, 'POST /reservations/expire', 403, asParticipant);
        assert.deepEqual(await call(expire, 'POST /reservations/expire', 200, asAdmin), { expired: 1 });

        const reminderBody = { minutesBefore: 30, message: 'Recordatorio de prueba' };
        await call(notify, 'POST /events/{id}/reminders', 401, { id, body: reminderBody });
        await call(notify, 'POST /events/{id}/reminders', 403, { ...asParticipant, body: reminderBody });
        await call(notify, 'POST /events/{id}/reminders', 400, {
            ...asAdmin, body: { ...reminderBody, minutesBefore: 0 }
        });
        const reminder = await call(notify, 'POST /events/{id}/reminders', 201, {
            ...asAdmin, body: reminderBody
        });
        await call(notify, 'POST /events/{id}/reminders', 409, { ...asAdmin, body: reminderBody });
        const [listed] = await call(notify, 'GET /events/{id}/reminders', 200, asAdmin);
        assert.equal(listed._id, reminder._id);
        assert.equal(new Date(listed.dueAt).getTime(), eventDate.getTime() - 30 * 60000);
        const changed = await call(notify, 'PATCH /reminders/{id}', 200, {
            ...asAdmin, id: reminder._id, body: { minutesBefore: 45 }
        });
        assert.equal(changed.minutesBefore, 45);
        const cancelled = await call(notify, 'DELETE /reminders/{id}', 200, {
            ...asAdmin, id: reminder._id
        });
        assert.equal(cancelled.status, 'CANCELLED');
        const live = await call(notify, 'POST /events/{id}/reminders', 201, {
            ...asAdmin, body: reminderBody
        });

        const newDate = new Date(eventDate.getTime() + 3600000).toISOString();
        await call(edit, 'PATCH /events/{id}', 403, { ...asParticipant, body: { date: newDate } });
        await call(edit, 'PATCH /events/{id}', 200, { ...asAdmin, body: { date: newDate } });
        await call(edit, 'PATCH /events/{id}', 200, { ...asAdmin, body: { date: newDate } });
        const liveFilter = { _id: new ObjectId(live._id) };
        assert.equal((await jobs.findOne(liveFilter)).dueAt.getTime(), Date.parse(newDate) - 30 * 60000);
        await jobs.updateOne(liveFilter, { $set: { dueAt: new Date(0) } });

        await call(notify, 'POST /events/{id}/announcements', 201, { ...asAdmin, body: { message: 'Bienvenidos' } });
        await call(notify, 'POST /events/{id}/announcements', 409, { ...asAdmin, body: { message: 'Bienvenidos' } });
        await call(notify, 'GET /events/{id}/announcements', 403, { id, token: outsider.token });
        const announcements = await call(notify, 'GET /events/{id}/announcements', 200, asParticipant);
        assert.equal(announcements.length, 1);

        const processJobs = () => call(notify, 'POST /notifications/process', 200, asAdmin);
        const results = await Promise.all([processJobs(), processJobs()]);
        assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 3);
        assert.deepEqual(await processJobs(), { processed: 0, sent: 0 });
        const sent = await call(notify, historyRoute, 200, asParticipant);
        assert.deepEqual(sent.map(entry => entry.type).sort(), ['ANNOUNCEMENT', 'REMINDER', 'UPDATE']);
        assert.ok(sent.every(entry => entry.status === 'SIMULATED'));

        const future = await call(notify, 'POST /events/{id}/reminders', 201, {
            ...asAdmin, body: { ...reminderBody, message: 'Otro recordatorio' }
        });
        await call(edit, 'PATCH /events/{id}', 200, { ...asAdmin, body: { status: 'CANCELLED' } });
        assert.equal((await jobs.findOne({ _id: new ObjectId(future._id) })).status, 'CANCELLED');
        assert.deepEqual(await processJobs(), { processed: 1, sent: 1 });
        const final = await call(notify, historyRoute, 200, asParticipant);
        assert.equal(final.filter(entry => entry.type === 'CANCELLATION').length, 1);
        assert.deepEqual(await call(notify, historyRoute, 200, { token: outsider.token }), []);
        console.log('Notificaciones: CRUD, permisos JWT, reprogramación, cancelación y entregas sin duplicados.');
    } finally {
        await db.dropDatabase();
    }
}

test().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
