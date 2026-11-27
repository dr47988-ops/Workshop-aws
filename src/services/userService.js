const repository = require('../repositories/userRepository');
const { AppError } = require('../utils/errors');
const { objectIdSchema } = require('../utils/validations');

// Compatibilidad con pruebas locales anteriores.
async function requireUser(userId) {
    if (!userId) {
        throw new AppError('Falta el header x-user-id', 401);
    }

    if (!objectIdSchema.safeParse(userId).success) {
        throw new AppError('El header x-user-id es inválido', 401);
    }

    const user = await repository.findById(userId);

    if (!user) {
        throw new AppError('Usuario no encontrado', 401);
    }

    return user;
}

const { getHeader } = require('../utils/http');
const { authenticate, requireRole } = require('../handlers/auth');

function useLegacyIdentity(event) {
    return !getHeader(event, 'authorization') && process.env.WORKSHOP_LOCAL_LEGACY === 'true';
}

async function requireReservationUser(event) {
    if (useLegacyIdentity(event)) return requireUser(getHeader(event, 'x-user-id'));
    return (await authenticate(event)).user;
}

async function requireEventMutationAdmin(event) {
    if (useLegacyIdentity(event)) return;
    const { user } = await authenticate(event);
    requireRole(user, 'ADMIN');
}

module.exports = { requireUser, requireReservationUser, requireEventMutationAdmin };
