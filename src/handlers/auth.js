const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createHash, randomUUID } = require('node:crypto');
const { z } = require('zod');
const { connectDB } = require('../config/mongodb');
const users = require('../repositories/userRepository');
const { AppError, response } = require('../utils/errors');
const { getHeader, parseBody, wrap } = require('../utils/http');

const roles = Object.freeze(['ADMIN', 'ORGANIZER', 'PARTICIPANT']);
const accessSeconds = 900;
const sessionSeconds = 7 * 86400;
const digest = token => createHash('sha256').update(token).digest('hex');
const name = z.string().trim().min(1).max(100);
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).refine(value => Buffer.byteLength(value) <= 72);
const credentials = z.object({ email, password }).strict();
const registration = credentials.extend({ name });
const profile = z.object({ name }).strict();
const refreshBody = z.object({ refreshToken: z.string().min(1).max(4096) }).strict();
const denied = () => new AppError('Token o sesión inválidos', 401);

function input(schema, event) {
    const parsed = schema.safeParse(parseBody(event));
    if (!parsed.success) throw new AppError('Datos inválidos', 400);
    return parsed.data;
}

function secret(type) {
    const access = process.env.JWT_ACCESS_SECRET;
    const refresh = process.env.JWT_REFRESH_SECRET;
    if (!access || !refresh || access.length < 32 || refresh.length < 32 || access === refresh) {
        throw new Error('Configura dos secretos JWT distintos de al menos 32 caracteres');
    }
    return type === 'access' ? access : refresh;
}

function sign(type, userId, sid, expiresIn) {
    return jwt.sign({ sid, type }, secret(type), {
        algorithm: 'HS256', issuer: 'workshop-events', audience: type,
        subject: userId, jwtid: randomUUID(), expiresIn
    });
}

function verify(type, token) {
    const key = secret(type);
    try {
        const claims = jwt.verify(token, key, {
            algorithms: ['HS256'], issuer: 'workshop-events', audience: type
        });
        if (claims.type !== type || !/^[a-f0-9]{24}$/.test(claims.sub || '') ||
            typeof claims.sid !== 'string' || !Number.isInteger(claims.exp)) throw denied();
        return claims;
    } catch {
        throw denied();
    }
}

let collections;
async function storage() {
    if (!collections) {
        collections = (async () => {
            const db = await connectDB();
            const sessions = db.collection('authSessions');
            const userCollection = db.collection('users');
            await userCollection.createIndex({ email: 1 }, { unique: true });
            await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
            return { sessions, userCollection };
        })().catch(error => { collections = undefined; throw error; });
    }
    return collections;
}

const active = claims => ({
    _id: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { $gt: new Date() }
});
const publicUser = user => ({
    id: String(user._id), name: user.name, email: user.email, role: user.role
});

async function authenticate(event) {
    const token = /^Bearer ([^\s]+)$/i.exec(getHeader(event, 'authorization') || '')?.[1];
    if (!token) throw denied();
    const claims = verify('access', token);
    const { sessions } = await storage();
    if (!await sessions.findOne(active(claims))) throw denied();
    const user = await users.findById(claims.sub);
    if (!user || !roles.includes(user.role)) throw denied();
    return { user, claims };
}

function requireRole(user, ...allowed) {
    if (!allowed.includes(user.role) || !roles.includes(user.role)) {
        throw new AppError('Acceso denegado', 403);
    }
}

function requireOwner(user, ownerId) {
    if (!ownerId || String(user._id) !== String(ownerId)) {
        throw new AppError('Acceso denegado', 403);
    }
}

function tokenPair(userId, sid, remaining) {
    const expiresIn = Math.min(accessSeconds, remaining);
    return {
        accessToken: sign('access', userId, sid, expiresIn),
        refreshToken: sign('refresh', userId, sid, remaining),
        tokenType: 'Bearer', expiresIn
    };
}

const routes = {
    'POST /auth/register': async event => {
        const data = input(registration, event);
        await storage();
        const now = new Date();
        const user = await users.create({
            name: data.name, email: data.email, passwordHash: await bcrypt.hash(data.password, 12),
            role: 'PARTICIPANT', isDeleted: false, createdAt: now, updatedAt: now
        });
        return response(201, publicUser(user));
    },
    'POST /auth/login': async event => {
        const data = input(credentials, event);
        const { sessions, userCollection } = await storage();
        const user = await userCollection.findOne({ email: data.email, isDeleted: { $ne: true } });
        if (!user?.passwordHash || !roles.includes(user.role) ||
            !await bcrypt.compare(data.password, user.passwordHash)) {
            throw new AppError('Credenciales inválidas', 401);
        }
        const userId = String(user._id);
        const sid = randomUUID();
        const tokens = tokenPair(userId, sid, sessionSeconds);
        await sessions.insertOne({
            _id: sid, userId, refreshHash: digest(tokens.refreshToken), revokedAt: null,
            expiresAt: new Date(Date.now() + sessionSeconds * 1000)
        });
        return response(200, tokens);
    },
    'POST /auth/refresh': async event => {
        const { refreshToken } = input(refreshBody, event);
        const claims = verify('refresh', refreshToken);
        const { sessions } = await storage();
        const query = { ...active(claims), refreshHash: digest(refreshToken) };
        const session = await sessions.findOne(query);
        const user = await users.findById(claims.sub);
        if (!session || !user || !roles.includes(user.role)) throw denied();
        const remaining = Math.min(claims.exp - Math.floor(Date.now() / 1000),
            Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
        if (remaining < 1) throw denied();
        const tokens = tokenPair(claims.sub, claims.sid, remaining);
        const result = await sessions.updateOne(query, { $set: { refreshHash: digest(tokens.refreshToken) } });
        if (!result.modifiedCount) throw denied();
        return response(200, tokens);
    },
    'POST /auth/logout': async event => {
        const { refreshToken } = input(refreshBody, event);
        const claims = verify('refresh', refreshToken);
        const { sessions } = await storage();
        const result = await sessions.updateOne({ ...active(claims), refreshHash: digest(refreshToken) },
            { $set: { revokedAt: new Date() }, $unset: { refreshHash: '' } });
        if (!result.modifiedCount) throw denied();
        return response(200, { success: true });
    },
    'GET /users/me': async event => {
        const { user } = await authenticate(event);
        return response(200, publicUser(user));
    },
    'PATCH /users/me': async event => {
        const { user } = await authenticate(event);
        const data = input(profile, event);
        const { userCollection } = await storage();
        const updated = await userCollection.findOneAndUpdate(
            { _id: user._id, isDeleted: { $ne: true } },
            { $set: { name: data.name, updatedAt: new Date() } },
            { returnDocument: 'after' }
        );
        if (!updated) throw denied();
        return response(200, publicUser(updated));
    }
};

const handler = wrap(event => {
    if (!Object.hasOwn(routes, event.routeKey)) throw new AppError('Ruta no encontrada', 404);
    return routes[event.routeKey](event);
});

module.exports = { handler, authenticate, requireRole, requireOwner, roles };
