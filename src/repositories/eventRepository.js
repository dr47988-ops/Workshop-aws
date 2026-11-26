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

async function findById(id) {
    const collection = await getCollection();

    return collection.findOne({
        _id: new ObjectId(id),
        isDeleted: false
    });
}

async function findAll(filter, sort, limit) {
    const collection = await getCollection();

    return collection
        .find(filter)
        .sort(sort)
        .limit(limit)
        .toArray();
}

async function update(id, data, conditions = {}) {
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
            includeResultMetadata: false
        }
    );
}

module.exports = {
    create,
    findById,
    findAll,
    update
};