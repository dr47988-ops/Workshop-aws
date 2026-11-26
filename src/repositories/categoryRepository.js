const { ObjectId } = require('mongodb');
const { connectDB } = require('../config/mongodb');

const nameCollation = { locale: 'es', strength: 2 };

async function create(category) {
    const db = await connectDB();
    const { insertedId } = await db.collection('categories').insertOne(category);
    return { ...category, _id: insertedId };
}

async function findAll() {
    const db = await connectDB();
    return db.collection('categories')
        .find({ isDeleted: { $ne: true } })
        .collation(nameCollation)
        .sort({ name: 1 })
        .toArray();
}

async function exists(id) {
    const db = await connectDB();
    const category = await db.collection('categories').findOne({
        _id: new ObjectId(id),
        isDeleted: { $ne: true }
    });

    return Boolean(category);
}

module.exports = { create, findAll, exists, nameCollation };
