const { ObjectId } = require('mongodb');
const { connectDB } = require('../config/mongodb');

async function getCollection() {
    const db = await connectDB();
    return db.collection('users');
}

async function create(user) {
    const collection = await getCollection();
    const { insertedId } = await collection.insertOne(user);

    return { ...user, _id: insertedId };
}

async function findById(id) {
    const collection = await getCollection();

    return collection.findOne({
        _id: new ObjectId(id),
        isDeleted: { $ne: true }
    });
}

module.exports = { create, findById };
