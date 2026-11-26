const { connectDB } = require('./src/config/mongodb');

async function testConnection() {
    try {
        const db = await connectDB();

        await db.command({ ping: 1 });

        console.log('Conexión exitosa con MongoDB Atlas');
        console.log('Base de datos:', db.databaseName);

        const collections = await db.listCollections().toArray();

        console.log('Colecciones disponibles:');

        collections.forEach(collection => {
            console.log('-', collection.name);
        });

        process.exit(0);

    } catch (error) {
        console.error('Error de conexión:', error.message);
        process.exit(1);
    }
}

testConnection();