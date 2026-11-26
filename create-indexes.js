const { connectDB } = require('./src/config/mongodb');

async function createIndexes() {
    try {
        const db = await connectDB();
        const events = db.collection('events');

        await events.createIndex({
            isDeleted: 1,
            _id: 1
        });

        await events.createIndex({
            isDeleted: 1,
            status: 1,
            _id: 1
        });

        await events.createIndex({
            isDeleted: 1,
            categoryId: 1,
            _id: 1
        });

        await events.createIndex({
            date: 1
        });

        console.log('Indices creados correctamente');

        const indexes = await events.indexes();

        console.log(indexes);

        process.exit(0);

    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

createIndexes();