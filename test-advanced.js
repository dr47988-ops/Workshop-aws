const assert = require('node:assert/strict');
const create = require('./src/handlers/createEvent');
const list = require('./src/handlers/listEvents');
const get = require('./src/handlers/getEvent');
const update = require('./src/handlers/updateEvent');

const categoryId = '6b07811febf572464c15c5b4';
const eventId = '6b07811fe202abba8d0d5dc8';

async function test() {
    let passed = 0;

    async function check(name, callback) {
        await callback();
        passed++;
        console.log('OK - ' + name);
    }

    // Crear eventos adicionales para la paginación
    for (let i = 1; i <= 3; i++) {
        const result = await create.handler({
            body: JSON.stringify({
                title: `Workshop de Software ${i}`,
                description: 'Evento de prueba avanzada',
                categoryId,
                location: 'San Carlos',
                date: '2027-04-15T15:00:00Z',
                ticketTypes: [
                    {
                        name: 'General',
                        price: 5000,
                        capacity: 50
                    }
                ]
            })
        });

        assert.equal(result.statusCode, 201);
    }

    await check('Filtro por estado', async () => {
        const result = await list.handler({
            queryStringParameters: {
                status: 'DRAFT'
            }
        });

        assert.equal(result.statusCode, 200);
        const data = JSON.parse(result.body);
        assert.ok(data.events.length > 0);
        assert.ok(data.events.every(
            e => e.status === 'DRAFT'
        ));
    });

    await check('Filtro por categoria', async () => {
        const result = await list.handler({
            queryStringParameters: { categoryId }
        });

        assert.equal(result.statusCode, 200);
        const data = JSON.parse(result.body);
        assert.ok(data.events.length > 0);
        assert.ok(data.events.every(
            e => e.categoryId === categoryId
        ));
    });

    await check('Busqueda de eventos', async () => {
        const result = await list.handler({
            queryStringParameters: {
                search: 'Workshop de Software'
            }
        });

        assert.equal(result.statusCode, 200);
        const data = JSON.parse(result.body);
        assert.ok(data.events.length >= 3);
    });

    await check('Ordenamiento ascendente', async () => {
        const result = await list.handler({
            queryStringParameters: {
                order: 'asc'
            }
        });

        assert.equal(result.statusCode, 200);
        const ids = JSON.parse(result.body)
            .events.map(e => e._id);

        assert.deepEqual(ids, [...ids].sort());
    });

    await check('Paginacion por cursor', async () => {
        const first = await list.handler({
            queryStringParameters: {
                search: 'Workshop de Software',
                limit: '2',
                order: 'asc'
            }
        });

        assert.equal(first.statusCode, 200);
        const page1 = JSON.parse(first.body);

        assert.equal(page1.events.length, 2);
        assert.equal(page1.pagination.hasMore, true);
        assert.ok(page1.pagination.nextCursor);

        const second = await list.handler({
            queryStringParameters: {
                search: 'Workshop de Software',
                limit: '2',
                order: 'asc',
                cursor: page1.pagination.nextCursor
            }
        });

        assert.equal(second.statusCode, 200);
        const page2 = JSON.parse(second.body);
        assert.ok(page2.events.length > 0);

        const ids = page1.events.map(e => e._id);

        assert.ok(page2.events.every(
            e => !ids.includes(e._id)
        ));
    });

    await check('ID invalido - 400', async () => {
        const result = await get.handler({
            pathParameters: { id: '123' }
        });

        assert.equal(result.statusCode, 400);
    });

    await check('Evento inexistente - 404', async () => {
        const result = await get.handler({
            pathParameters: {
                id: '000000000000000000000000'
            }
        });

        assert.equal(result.statusCode, 404);
    });

    await check('Datos incompletos - 400', async () => {
        const result = await create.handler({
            body: JSON.stringify({
                title: 'Prueba'
            })
        });

        assert.equal(result.statusCode, 400);
    });

    await check('Estado invalido - 400', async () => {
        const result = await list.handler({
            queryStringParameters: {
                status: 'INVALID'
            }
        });

        assert.equal(result.statusCode, 400);
    });

    await check('Actualizacion vacia - 400', async () => {
        const result = await update.handler({
            pathParameters: { id: eventId },
            body: '{}'
        });

        assert.equal(result.statusCode, 400);
    });

    console.log('\nTOTAL: ' + passed + '/10');
    console.log('TODAS LAS PRUEBAS AVANZADAS EXITOSAS');

    process.exit(0);
}

test().catch(error => {
    console.error('PRUEBA FALLIDA:', error.message);
    process.exit(1);
});