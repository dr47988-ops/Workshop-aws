const { ObjectId } = require('mongodb');
const { connectDB } = require('../config/mongodb');

async function getCollection() {
    const db = await connectDB();
    return db.collection('events');
}

async function create(event) {
    const collection = await getCollection();
    const result = await collection.insertOne(event);

    return {
        ...event,
        _id: result.insertedId
    };
}

async function findById(id, session) {
    const collection = await getCollection();

    return collection.findOne({
        _id: new ObjectId(id),
        isDeleted: false
    }, { session });
}

async function findAll(filter, sort, limit) {
    const collection = await getCollection();

    return collection
        .find(filter)
        .sort(sort)
        .limit(limit)
        .toArray();
}

async function update(id, data, conditions = {}, session) {
    const collection = await getCollection();

    return collection.findOneAndUpdate(
        {
            _id: new ObjectId(id),
            isDeleted: false,
            ...conditions
        },
        {
            $set: {
                ...data,
                updatedAt: new Date()
            }
        },
        {
            returnDocument: 'after',
            includeResultMetadata: false,
            session
        }
    );
}

module.exports = {
    create,
    findById,
    findAll,
    update
};
// Descuenta entradas en una sola operación atómica: la condición y el
// descuento se evalúan juntos en MongoDB, así dos compras al mismo tiempo
// nunca pueden dejar el inventario en negativo.
async function reserveTickets(eventId, ticketTypeId, quantity, session) {
    const collection = await getCollection();

    const result = await collection.updateOne(
        {
            _id: new ObjectId(eventId),
            isDeleted: false,
            status: 'PUBLISHED',
            date: { $gt: new Date() },
            ticketTypes: {
                $elemMatch: {
                    _id: new ObjectId(ticketTypeId),
                    available: { $gte: quantity }
                }
            }
        },
        {
            $inc: { 'ticketTypes.$.available': -quantity },
            $set: { updatedAt: new Date() }
        },
        { session }
    );

    return result.modifiedCount === 1;
}

async function releaseTickets(eventId, ticketTypeId, quantity, session) {
    const collection = await getCollection();

    const result = await collection.updateOne(
        {
            _id: new ObjectId(eventId),
            'ticketTypes._id': new ObjectId(ticketTypeId)
        },
        {
            $inc: { 'ticketTypes.$.available': quantity },
            $set: { updatedAt: new Date() }
        },
        { session }
    );
    return result.modifiedCount === 1;
}

module.exports.reserveTickets = reserveTickets;
module.exports.releaseTickets = releaseTickets;

async function lockEvent(id, session) {
    const collection = await getCollection();
    await collection.updateOne({ _id: new ObjectId(id) }, { $inc: { notificationRevision: 1 } }, { session });
}

module.exports.lockEvent = lockEvent;
