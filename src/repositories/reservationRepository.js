const { ObjectId } = require('mongodb');
const { connectDB } = require('../config/mongodb');

async function getCollection() {
    const db = await connectDB();
    return db.collection('reservations');
}

async function create(reservation) {
    const collection = await getCollection();
    const { insertedId } = await collection.insertOne(reservation);

    return { ...reservation, _id: insertedId };
}

async function findById(id) {
    const collection = await getCollection();

    return collection.findOne({ _id: new ObjectId(id) });
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
async function changeStatus(id, fromStatus, data) {
    const collection = await getCollection();

    return collection.findOneAndUpdate(
        { _id: new ObjectId(id), status: fromStatus },
        { $set: { ...data, updatedAt: new Date() } },
        { returnDocument: 'after', includeResultMetadata: false }
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

module.exports = { create, findById, findByUser, changeStatus, findExpired };
