const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ObjectId } = require('mongodb');

process.env.DB_NAME = 'workshop_persona4_' + randomUUID().replace(/-/g, '');

const { connectDB } = require('./src/config/mongodb');
const { nameCollation } = require('./src/repositories/categoryRepository');

const handlers = {
    createCategory: require('./src/handlers/createCategory').handler,
    createEvent: require('./src/handlers/createEvent').handler,
    publishEvent: require('./src/handlers/publishEvent').handler,
    createReservation: require('./src/handlers/createReservation').handler,
    cancelReservation: require('./src/handlers/cancelReservation').handler,
    getMyReservations: require('./src/handlers/getMyReservations').handler
};

async function call(handler, expectedStatus, request = {}) {
    const result = await handlers[handler](request);
    const body = JSON.parse(result.body);
    assert.equal(result.statusCode, expectedStatus, JSON.stringify(body));
    return body;
}

async function test() {
    const db = await connectDB();
    try {
        await db.collection('categories').createIndex(
            { name: 1 }, { unique: true, collation: nameCollation }
        );
        await db.collection('users').createIndex({ email: 1 }, { unique: true });

        const users = db.collection('users');
        const idA = (await users.insertOne({ name: 'A', email: 'a@test.com', isDeleted: false })).insertedId.toString();
        const idB = (await users.insertOne({ name: 'B', email: 'b@test.com', isDeleted: false })).insertedId.toString();

        // Usuarios: header faltante, mal formado o inexistente
        await call('getMyReservations', 401, {});
        await call('getMyReservations', 401, { headers: { 'x-user-id': 'abc' } });
        await call('getMyReservations', 401, { headers: { 'x-user-id': new ObjectId().toString() } });
        await assert.rejects(users.insertOne({ name: 'C', email: 'a@test.com' }), { code: 11000 });
        console.log('Usuarios: sin header, ID inválido y usuario inexistente 401; correo duplicado rechazado por el índice.');

        const category = (await call('createCategory', 201, { body: '{"name":"Cine"}' })).data;
        const event = (await call('createEvent', 201, {
            body: JSON.stringify({
                title: 'Función especial',
                description: 'Evento para probar el listado',
                categoryId: category._id,
                location: 'Ciudad Quesada',
                date: new Date(Date.now() + 86400000).toISOString(),
                ticketTypes: [{ name: 'General', price: 3000, capacity: 20 }]
            })
        })).data;
        await call('publishEvent', 200, { pathParameters: { id: event._id } });
        const ticketTypeId = event.ticketTypes[0]._id;
        const reserve = userId => call('createReservation', 201, {
            headers: { 'x-user-id': userId },
            pathParameters: { id: event._id },
            body: JSON.stringify({ items: [{ ticketTypeId, quantity: 1 }] })
        });

        // Sin reservaciones el listado viene vacío
        const empty = await call('getMyReservations', 200, { headers: { 'x-user-id': idA } });
        assert.deepEqual(empty.reservations, []);

        const ids = [];
        for (let i = 0; i < 3; i++) ids.push((await reserve(idA)).data._id);
        await reserve(idB);
        await call('cancelReservation', 200, {
            headers: { 'x-user-id': idA }, pathParameters: { id: ids[0] }
        });

        // Solo aparecen las del usuario, de la más nueva a la más vieja
        const all = await call('getMyReservations', 200, { headers: { 'x-user-id': idA } });
        assert.deepEqual(all.reservations.map(item => item._id), [...ids].reverse());
        assert.ok(all.reservations.every(item => item.userId === idA));
        assert.equal(all.pagination.hasMore, false);

        // Filtro por estado
        const cancelled = await call('getMyReservations', 200, {
            headers: { 'x-user-id': idA }, queryStringParameters: { status: 'CANCELLED' }
        });
        assert.deepEqual(cancelled.reservations.map(item => item._id), [ids[0]]);
        await call('getMyReservations', 400, {
            headers: { 'x-user-id': idA }, queryStringParameters: { status: 'OTRO' }
        });

        // Paginación por cursor
        const page1 = await call('getMyReservations', 200, {
            headers: { 'x-user-id': idA }, queryStringParameters: { limit: '2' }
        });
        assert.equal(page1.reservations.length, 2);
        assert.equal(page1.pagination.hasMore, true);
        const page2 = await call('getMyReservations', 200, {
            headers: { 'x-user-id': idA },
            queryStringParameters: { limit: '2', cursor: page1.pagination.nextCursor }
        });
        assert.deepEqual(
            [...page1.reservations, ...page2.reservations].map(item => item._id),
            [...ids].reverse()
        );
        assert.equal(page2.pagination.hasMore, false);
        console.log('GET /users/me/reservations: solo las del usuario, filtro por estado y paginación por cursor.');

        // Manejo centralizado de errores: un ID mal formado siempre sale 400/404, nunca 500
        await call('getMyReservations', 400, {
            headers: { 'x-user-id': idA }, queryStringParameters: { cursor: 'zzz' }
        });
        await call('createReservation', 400, {
            headers: { 'x-user-id': idA }, pathParameters: { id: 'zzz' }, body: '{"items":[]}'
        });
        await call('createReservation', 400, {
            headers: { 'x-user-id': idA }, pathParameters: { id: event._id }, body: '{'
        });
        console.log('Errores: cursor o ID inválido 400 y JSON mal formado 400, con el mismo formato de respuesta.');
    } finally {
        await db.dropDatabase();
    }
}

test().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
