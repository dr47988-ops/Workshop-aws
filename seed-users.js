const { connectDB } = require('./src/config/mongodb');

const users = [
    { name: 'Usuario Demo', email: 'demo@workshop.com' },
    { name: 'Usuario Dos', email: 'dos@workshop.com' }
];

async function seed() {
    try {
        const db = await connectDB();
        const collection = db.collection('users');

        await collection.createIndex({ email: 1 }, { unique: true });

        for (const user of users) {
            const now = new Date();

            await collection.updateOne(
                { email: user.email },
                {
                    $setOnInsert: {
                        ...user,
                        isDeleted: false,
                        createdAt: now
                    },
                    $set: { updatedAt: now }
                },
                { upsert: true }
            );
        }

        const saved = await collection
            .find({ email: { $in: users.map(user => user.email) } })
            .toArray();

        console.log('Usuarios disponibles (usar el _id en el header x-user-id):');
        saved.forEach(user => console.log(user._id.toString(), user.email));

        process.exit(0);

    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

seed();
