const { ObjectId } = require('mongodb');
const { connectDB } = require('../config/mongodb');

async function getCollection() {
    const db = await connectDB();
    return db.collection('reservations');
}

async function create(reservation, session) {
    const collection = await getCollection();
    const { insertedId } = await collection.insertOne(reservation, { session });

    return { ...reservation, _id: insertedId };
}

async function findById(id, session) {
    const collection = await getCollection();

    return collection.findOne({ _id: new ObjectId(id) }, { session });
}

async function findByUser(filter, sort, limit) {
    const collection = await getCollection();

    return collection
        .find(filter)
        .sort(sort)
        .limit(limit)
        .toArray();
}

// Pasa la reservación de un estado a otro solo si todavía está en el estado
// esperado. Si dos peticiones compiten, solo una logra el cambio.
async function changeStatus(id, fromStatus, data, conditions, session) {
    const collection = await getCollection();

    return collection.findOneAndUpdate(
        { _id: new ObjectId(id), status: fromStatus, ...conditions },
        {
            $set: { ...data, updatedAt: new Date() },
            $push: { history: { from: fromStatus, to: data.status, at: new Date() } }
        },
        { returnDocument: 'after', includeResultMetadata: false, session }
    );
}

async function findExpired(now, limit, userId) {
    const collection = await getCollection();
    const filter = {
        status: 'PENDING',
        expiresAt: { $lte: now }
    };

    if (userId) {
        filter.userId = new ObjectId(userId);
    }

    return collection
        .find(filter)
        .sort({ expiresAt: 1 })
        .limit(limit)
        .toArray();
}

async function findOne(filter, session) {
    const collection = await getCollection();
    return collection.findOne(filter, { session });
}

async function notificationRecipients(eventId, now, session) {
    const collection = await getCollection();
    const recipients = await collection.aggregate([
        { $match: { eventId, $or: [
            { status: 'CONFIRMED' }, { status: 'PENDING', expiresAt: { $gt: now } }
        ] } },
        { $group: { _id: '$userId' } }
    ], { session }).toArray();
    return recipients.map(({ _id }) => _id);
}

module.exports = { notificationRecipients, findOne, create, findById, findByUser, changeStatus, findExpired };
