const { connectDB } = require('./src/config/mongodb');

const { registerIndexes } = require('./src/repositories/notificationRepository');
const { nameCollation } = require('./src/repositories/categoryRepository');

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

        const categories = db.collection('categories');
        await categories.createIndex(
            { name: 1 },
            { unique: true, collation: nameCollation }
        );

        const users = db.collection('users');
        await users.createIndex({ email: 1 }, { unique: true });

        const reservations = db.collection('reservations');

        // Consulta de reservaciones de un usuario con paginación por cursor
        await reservations.createIndex({ userId: 1, _id: -1 });
        await reservations.createIndex({ userId: 1, status: 1, _id: -1 });

        // Reservaciones de un evento
        await reservations.createIndex({ eventId: 1, status: 1 });

        // Búsqueda de reservaciones pendientes que ya vencieron
        await reservations.createIndex({ status: 1, expiresAt: 1 });

        await reservations.createIndex({ eventId: 1, userId: 1, status: 1 });
        await reservations.createIndex(
            { userId: 1, idempotencyKey: 1 },
            { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
        );
        await registerIndexes(db);

        console.log('Indices creados correctamente');

        const indexes = await events.indexes();

        console.log(indexes);
        console.log(await categories.indexes());
        console.log(await users.indexes());
        console.log(await reservations.indexes());

        process.exit(0);

    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

createIndexes();