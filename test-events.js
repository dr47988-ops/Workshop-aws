const { connectDB } = require('./src/config/mongodb');

const createEvent = require('./src/handlers/createEvent');
const listEvents = require('./src/handlers/listEvents');
const getEvent = require('./src/handlers/getEvent');
const updateEvent = require('./src/handlers/updateEvent');

async function test() {
    try {
        const db = await connectDB();

        // Crear o recuperar categoría de prueba
        const category = await db.collection('categories')
            .findOneAndUpdate(
                { name: 'Tecnología' },
                {
                    $setOnInsert: {
                        name: 'Tecnología',
                        description: 'Eventos tecnológicos',
                        isDeleted: false,
                        createdAt: new Date()
                    }
                },
                {
                    upsert: true,
                    returnDocument: 'after'
                }
            );

        console.log('\n=== CATEGORIA DE PRUEBA ===');
        console.log(category._id.toString());

        // POST /events
        console.log('\n=== POST /events ===');

        const created = await createEvent.handler({
            body: JSON.stringify({
                title: 'Conferencia de Tecnología 2027',
                description: 'Conferencia sobre desarrollo de software',
                categoryId: category._id.toString(),
                location: 'Ciudad Quesada, San Carlos',
                date: '2027-03-20T15:00:00Z',
                ticketTypes: [
                    {
                        name: 'General',
                        price: 10000,
                        capacity: 100
                    },
                    {
                        name: 'VIP',
                        price: 25000,
                        capacity: 30
                    }
                ]
            })
        });

        console.log(created.statusCode);
        console.log(JSON.parse(created.body));

        if (created.statusCode !== 201) {
            throw new Error('No se pudo crear el evento');
        }

        const id = JSON.parse(created.body).data._id;

        // GET /events
        console.log('\n=== GET /events ===');

        const listed = await listEvents.handler({
            queryStringParameters: {
                status: 'DRAFT',
                limit: '5',
                order: 'desc'
            }
        });

        console.log(listed.statusCode);
        console.log(JSON.parse(listed.body));

        // GET /events/{id}
        console.log('\n=== GET /events/{id} ===');

        const found = await getEvent.handler({
            pathParameters: { id }
        });

        console.log(found.statusCode);
        console.log(JSON.parse(found.body));

        // PATCH /events/{id}
        console.log('\n=== PATCH /events/{id} ===');

        const updated = await updateEvent.handler({
            pathParameters: { id },
            body: JSON.stringify({
                title: 'Conferencia Internacional de Tecnología 2027',
                location: 'Centro de Eventos San Carlos'
            })
        });

        console.log(updated.statusCode);
        console.log(JSON.parse(updated.body));

        // Verificar persistencia
        console.log('\n=== PERSISTENCIA EN MONGODB ===');

        const saved = await db.collection('events').findOne({
            _id: new (require('mongodb').ObjectId)(id)
        });

        console.log(saved);

        const success =
            listed.statusCode === 200 &&
            found.statusCode === 200 &&
            updated.statusCode === 200 &&
            saved?.title ===
                'Conferencia Internacional de Tecnología 2027';

        if (!success) {
            throw new Error('Una o más pruebas fallaron');
        }

        console.log('\nTODAS LAS PRUEBAS BASICAS EXITOSAS');

        process.exit(0);

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

test();