const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ObjectId } = require('mongodb');

process.env.DB_NAME = 'workshop_persona3_' + randomUUID().replace(/-/g, '');

const { connectDB } = require('./src/config/mongodb');
const { nameCollation } = require('./src/repositories/categoryRepository');
const reservationService = require('./src/services/reservationService');

const handlers = {
    createCategory: require('./src/handlers/createCategory').handler,
    createEvent: require('./src/handlers/createEvent').handler,
    publishEvent: require('./src/handlers/publishEvent').handler,
    createReservation: require('./src/handlers/createReservation').handler,
    getReservation: require('./src/handlers/getReservation').handler,
    cancelReservation: require('./src/handlers/cancelReservation').handler
};

async function call(handler, expectedStatus, request = {}) {
    const result = await handlers[handler](request);
    const body = JSON.parse(result.body);
    assert.equal(result.statusCode, expectedStatus, JSON.stringify(body));
    return body.data ?? body;
}

async function test() {
    const db = await connectDB();
    try {
        const events = db.collection('events');
        const reservations = db.collection('reservations');
        await db.collection('categories').createIndex(
            { name: 1 }, { unique: true, collation: nameCollation }
        );

        const userA = (await db.collection('users').insertOne({
            name: 'A', email: 'a@test.com', isDeleted: false
        })).insertedId.toString();
        const userB = (await db.collection('users').insertOne({
            name: 'B', email: 'b@test.com', isDeleted: false
        })).insertedId.toString();
        const as = id => ({ 'x-user-id': id });

        const category = await call('createCategory', 201, {
            body: JSON.stringify({ name: 'Teatro' })
        });
        const created = await call('createEvent', 201, {
            body: JSON.stringify({
                title: 'Obra de prueba',
                description: 'Evento para probar reservaciones',
                categoryId: category._id,
                location: 'San Carlos',
                date: new Date(Date.now() + 86400000).toISOString(),
                ticketTypes: [
                    { name: 'General', price: 10000, capacity: 5 },
                    { name: 'VIP', price: 25000.5, capacity: 2 }
                ]
            })
        });
        const eventId = created._id;
        const general = created.ticketTypes[0]._id;
        const vip = created.ticketTypes[1]._id;
        const path = { id: eventId };
        const stock = async () => {
            const doc = await events.findOne({ _id: new ObjectId(eventId) });
            return doc.ticketTypes.map(ticket => ticket.available);
        };
        const reserve = (user, items, status = 201) => call('createReservation', status, {
            headers: as(user),
            pathParameters: path,
            body: JSON.stringify({ items })
        });

        // Un evento en borrador no se puede reservar
        await reserve(userA, [{ ticketTypeId: general, quantity: 1 }], 409);
        await call('publishEvent', 200, { pathParameters: path });

        // Validaciones
        await call('createReservation', 401, {
            pathParameters: path, body: '{"items":[]}'
        });
        await reserve(userA, [], 400);
        await reserve(userA, [{ ticketTypeId: general, quantity: 0 }], 400);
        await reserve(userA, [{ ticketTypeId: new ObjectId().toString(), quantity: 1 }], 404);
        await reserve(userA, [
            { ticketTypeId: general, quantity: 1 },
            { ticketTypeId: general, quantity: 1 }
        ], 400);
        await call('createReservation', 404, {
            headers: as(userA),
            pathParameters: { id: new ObjectId().toString() },
            body: JSON.stringify({ items: [{ ticketTypeId: general, quantity: 1 }] })
        });
        assert.deepEqual(await stock(), [5, 2]);
        console.log('Validaciones: sin usuario 401, evento en borrador 409, datos inválidos 400, no existe 404.');

        // Reservación con dos tipos de entrada, subtotales, impuesto y 15 minutos
        const first = await reserve(userA, [
            { ticketTypeId: general, quantity: 2 },
            { ticketTypeId: vip, quantity: 1 }
        ]);
        assert.equal(first.status, 'PENDING');
        assert.equal(first.items[0].subtotal, 20000);
        assert.equal(first.items[1].subtotal, 25000.5);
        assert.equal(first.subtotal, 45000.5);
        assert.equal(first.tax, 5850.07);
        assert.equal(first.total, 50850.57);
        const minutes = (new Date(first.expiresAt) - new Date(first.createdAt)) / 60000;
        assert.equal(minutes, 15);
        assert.deepEqual(await stock(), [3, 1]);
        assert.ok(await reservations.findOne({ _id: new ObjectId(first._id) }));
        console.log('Reservación: 201, subtotales, impuesto 13%, total, vence a los 15 min e inventario descontado.');

        // Consulta: solo la ve su dueño
        const fetched = await call('getReservation', 200, {
            headers: as(userA), pathParameters: { id: first._id }
        });
        assert.equal(fetched._id, first._id);
        await call('getReservation', 404, {
            headers: as(userB), pathParameters: { id: first._id }
        });

        // Sobreventa: no alcanzan las entradas
        await reserve(userB, [{ ticketTypeId: general, quantity: 4 }], 409);
        // Si falla el segundo tipo, el primero se devuelve
        await reserve(userB, [
            { ticketTypeId: general, quantity: 1 },
            { ticketTypeId: vip, quantity: 2 }
        ], 409);
        assert.deepEqual(await stock(), [3, 1]);
        console.log('Inventario: pedido mayor al disponible 409 y descuentos parciales revertidos.');

        // Concurrencia: 20 compradores para 3 entradas generales
        const race = await Promise.all(Array.from({ length: 20 }, () =>
            handlers.createReservation({
                headers: as(userB),
                pathParameters: path,
                body: JSON.stringify({ items: [{ ticketTypeId: general, quantity: 1 }] })
            })
        ));
        const won = race.filter(result => result.statusCode === 201).length;
        assert.equal(won, 3);
        assert.equal(race.filter(result => result.statusCode === 409).length, 17);
        assert.deepEqual(await stock(), [0, 1]);
        console.log('Concurrencia: 20 intentos simultáneos por 3 entradas -> 3 aceptados, 17 rechazados, sin sobreventa.');

        // Cancelación libera el inventario una sola vez
        const cancelled = await call('cancelReservation', 200, {
            headers: as(userA), pathParameters: { id: first._id }
        });
        assert.equal(cancelled.status, 'CANCELLED');
        assert.deepEqual(await stock(), [2, 2]);
        await call('cancelReservation', 409, {
            headers: as(userA), pathParameters: { id: first._id }
        });
        assert.deepEqual(await stock(), [2, 2]);
        console.log('Cancelación: 200, inventario devuelto y segunda cancelación 409 sin devolver doble.');

        // Expiración: se fuerza el vencimiento de una reservación pendiente
        const pending = await reserve(userA, [{ ticketTypeId: vip, quantity: 2 }]);
        assert.deepEqual(await stock(), [2, 0]);
        await reservations.updateOne(
            { _id: new ObjectId(pending._id) },
            { $set: { expiresAt: new Date(Date.now() - 1000) } }
        );
        const expired = await call('getReservation', 200, {
            headers: as(userA), pathParameters: { id: pending._id }
        });
        assert.equal(expired.status, 'EXPIRED');
        assert.deepEqual(await stock(), [2, 2]);
        await call('cancelReservation', 409, {
            headers: as(userA), pathParameters: { id: pending._id }
        });

        // Expiración por lote (lo que hace la función programada)
        const another = await reserve(userA, [{ ticketTypeId: vip, quantity: 1 }]);
        await reservations.updateOne(
            { _id: new ObjectId(another._id) },
            { $set: { expiresAt: new Date(Date.now() - 1000) } }
        );
        assert.equal(await reservationService.expireDueReservations(), 1);
        assert.equal(await reservationService.expireDueReservations(), 0);
        assert.deepEqual(await stock(), [2, 2]);
        console.log('Expiración: reservación vencida pasa a EXPIRED, libera entradas una vez y no se puede cancelar.');
    } finally {
        await db.dropDatabase();
    }
}

test().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
