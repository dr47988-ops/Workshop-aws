const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.argv[2] || __dirname;
const load = file => require(path.join(root, file));
const jwt = load('node_modules/jsonwebtoken');
const { ObjectId } = load('node_modules/mongodb');
const config = load('src/config/mongodb');
const documents = { users: [], authSessions: [] };
const matches = (doc, query) => Object.entries(query).every(([key, value]) => {
    if (value && '$ne' in Object(value)) return doc[key] !== value.$ne;
    if (value && '$gt' in Object(value)) return doc[key] > value.$gt;
    return String(doc[key]) === String(value);
});
config.connectDB = async () => ({
    collection(name) {
        const rows = documents[name];
        const find = query => rows.find(doc => matches(doc, query));
        const update = (query, changes) => {
            const doc = find(query);
            if (!doc) return null;
            Object.assign(doc, changes.$set);
            for (const key of Object.keys(changes.$unset || {})) delete doc[key];
            return doc;
        };
        return {
            createIndex: async () => {},
            findOne: async query => find(query),
            insertOne: async doc => {
                const _id = doc._id || new ObjectId();
                rows.push({ ...doc, _id });
                return { insertedId: _id };
            },
            updateOne: async (query, changes) => ({ modifiedCount: update(query, changes) ? 1 : 0 }),
            findOneAndUpdate: async (query, changes) => update(query, changes)
        };
    }
});
process.env.JWT_ACCESS_SECRET = 'test-access-secret-for-persona-one-only';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-persona-one-only';
const { handler, requireRole, requireOwner } = load('src/handlers/auth');

async function call(routeKey, expected, data, token) {
    const result = await handler({
        routeKey, body: JSON.stringify(data),
        headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    assert.equal(result.statusCode, expected, routeKey);
    assert.equal(result.headers['Content-Type'], 'application/json');
    return JSON.parse(result.body);
}

async function main() {
    const credentials = { email: 'test@example.com', password: 'LocalTest123!' };
    await call('POST /auth/register', 400, { ...credentials, name: 'Test', role: 'ADMIN' });
    const user = await call('POST /auth/register', 201, { ...credentials, name: 'Test' });
    assert.equal(user.role, 'PARTICIPANT');
    assert.equal(user.passwordHash, undefined);
    await call('POST /auth/login', 401, { ...credentials, password: 'Invalid123!' });
    const first = await call('POST /auth/login', 200, credentials);
    await call('GET /users/me', 401);
    const me = await call('GET /users/me', 200, undefined, first.accessToken);
    assert.equal(me.id, user.id);
    const expired = jwt.sign({ sid: documents.authSessions[0]._id, type: 'access' },
        process.env.JWT_ACCESS_SECRET, {
            issuer: 'workshop-events', audience: 'access', subject: user.id, expiresIn: -1
        });
    await call('GET /users/me', 401, undefined, expired);
    await call('PATCH /users/me', 400, { name: 'New', role: 'ADMIN' }, first.accessToken);
    const updated = await call('PATCH /users/me', 200, { name: 'New' }, first.accessToken);
    assert.equal(updated.name, 'New');
    assert.throws(() => requireRole(documents.users[0], 'ADMIN'), { statusCode: 403 });
    assert.throws(() => requireOwner(documents.users[0], new ObjectId()), { statusCode: 403 });
    requireRole(documents.users[0], 'PARTICIPANT');
    requireOwner(documents.users[0], user.id);
    const second = await call('POST /auth/refresh', 200, { refreshToken: first.refreshToken });
    await call('POST /auth/refresh', 401, { refreshToken: first.refreshToken });
    await call('GET /users/me', 200, undefined, second.accessToken);
    await call('POST /auth/logout', 200, { refreshToken: second.refreshToken });
    await call('GET /users/me', 401, undefined, second.accessToken);
    await call('POST /auth/refresh', 401, { refreshToken: second.refreshToken });
    console.log('Persona 1: registro, login, perfil, roles, propiedad, vencimiento, rotación y logout correctos');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
