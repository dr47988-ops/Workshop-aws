const { connectDB } = require('../config/mongodb');

async function jobs() {
    return (await connectDB()).collection('notificationJobs');
}

async function deliveries() {
    return (await connectDB()).collection('notificationHistory');
}

async function registerIndexes(db) {
    await db.collection('notificationJobs').createIndex({ status: 1, dueAt: 1, _id: 1 });
    await db.collection('notificationJobs').createIndex({ eventId: 1, type: 1, createdAt: -1 });
    await db.collection('notificationJobs').createIndex(
        { eventId: 1, signature: 1 },
        { unique: true, partialFilterExpression: { signature: { $type: 'string' } } }
    );
    const history = db.collection('notificationHistory');
    await history.createIndex({ userId: 1, _id: -1 });
    await history.createIndex({ jobId: 1, userId: 1 }, { unique: true });
}

async function create(job, session) {
    const { insertedId } = await (await jobs()).insertOne(job, { session });
    return { ...job, _id: insertedId };
}

async function findOne(filter, session) {
    return (await jobs()).findOne(filter, { session });
}

async function list(filter, sort, limit, session) {
    return (await jobs()).find(filter, { session }).sort(sort).limit(limit).toArray();
}

async function change(filter, update, session) {
    return (await jobs()).findOneAndUpdate(filter, update, { session, returnDocument: 'after' });
}

async function cancelReminders(eventId, session) {
    await (await jobs()).updateMany(
        { eventId, type: 'REMINDER', status: 'PENDING' },
        { $set: { status: 'CANCELLED', updatedAt: new Date() }, $unset: { signature: '' } },
        { session }
    );
}

async function send(job, users, now, session) {
    if (!users.length) return;
    await (await deliveries()).insertMany(users.map(userId => ({
        jobId: job._id, eventId: job.eventId, userId, type: job.type,
        message: job.message, status: 'SIMULATED', sentAt: now
    })), { session });
}

async function history(userId, cursor) {
    const filter = { userId };
    if (cursor) filter._id = { $lt: cursor };
    return (await deliveries()).find(filter).sort({ _id: -1 }).limit(100).toArray();
}

module.exports = { registerIndexes, create, findOne, list, change, cancelReminders, send, history };
