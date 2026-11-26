const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ObjectId } = require('mongodb');

process.env.DB_NAME = 'workshop_persona2_' + randomUUID().replace(/-/g, '');

const { connectDB } = require('./src/config/mongodb');
const { nameCollation } = require('./src/repositories/categoryRepository');
const handlers = {
    createCategory: require('./src/handlers/createCategory').handler,
    listCategories: require('./src/handlers/listCategories').handler,
    createEvent: require('./src/handlers/createEvent').handler,
    getEvent: require('./src/handlers/getEvent').handler,
    listEvents: require('./src/handlers/listEvents').handler,
    publishEvent: require('./src/handlers/publishEvent').handler,
    deleteEvent: require('./src/handlers/deleteEvent').handler
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
        const categories = db.collection('categories');
        const events = db.collection('events');
        await categories.createIndex({ name: 1 }, { unique: true, collation: nameCollation });

        const category = await call('createCategory', 201, {
            body: JSON.stringify({ name: 'Música', description: 'Conciertos' })
        });
        await call('createCategory', 409, { body: '{"name":"música"}' });
        await call('createCategory', 400, { body: '{' });
        assert.deepEqual(await call('listCategories', 200), [category]);
        assert.ok(await categories.findOne({ _id: new ObjectId(category._id) }));
        console.log('Categorías: POST 201, duplicado 409, JSON inválido 400, GET 200 y registro persistido.');

        const eventBody = {
            title: 'Concierto de prueba',
            description: 'Evento para verificar los cambios de estado',
            categoryId: category._id,
            location: 'San José',
            date: new Date(Date.now() + 86400000).toISOString(),
            ticketTypes: [{ name: 'General', price: 1000, capacity: 15 }]
        };
        const event = await call('createEvent', 201, { body: JSON.stringify(eventBody) });
        const request = { pathParameters: { id: event._id } };
        const eventFilter = { _id: new ObjectId(event._id) };

        assert.equal(event.status, 'DRAFT');
        assert.ok((await events.findOne(eventFilter)).categoryId.equals(category._id));

        const expired = await call('createEvent', 201, {
            body: JSON.stringify({ ...eventBody, date: new Date(0).toISOString() })
        });
        await call('publishEvent', 409, { pathParameters: { id: expired._id } });
        assert.equal((await events.findOne({ _id: new ObjectId(expired._id) })).status, 'DRAFT');

        const published = await call('publishEvent', 200, request);
        assert.equal(published.status, 'PUBLISHED');
        assert.equal((await events.findOne(eventFilter)).status, 'PUBLISHED');
        await call('publishEvent', 409, request);
        console.log('Publicación: referencia ObjectId verificada, fecha vencida 409, PATCH 200 y PUBLISHED persistido.');

        await call('deleteEvent', 200, request);
        const deleted = await events.findOne(eventFilter);
        assert.equal(deleted.isDeleted, true);
        assert.ok(deleted.deletedAt instanceof Date);
        await call('getEvent', 404, request);
        await call('deleteEvent', 404, request);
        await call('publishEvent', 404, request);
        const list = await call('listEvents', 200);
        assert.ok(!list.events.some(item => item._id === event._id));
        console.log('Eliminación lógica: DELETE 200, documento conservado, excluido del listado y GET 404.');
    } finally {
        await db.dropDatabase();
    }
}

test().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
