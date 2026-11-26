require('dotenv').config();

const { MongoClient } = require('mongodb');

let clientPromise;

async function connectDB() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI no está configurada');
    }

    if (!clientPromise) {
        const client = new MongoClient(
            process.env.MONGODB_URI,
            {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 10000
            }
        );

        clientPromise = client.connect().catch((error) => {
            clientPromise = null;
            throw error;
        });
    }

    const client = await clientPromise;

    return client.db(process.env.DB_NAME || 'eventsdb');
}

module.exports = { connectDB };