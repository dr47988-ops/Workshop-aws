const repository = require('../repositories/userRepository');
const { AppError } = require('../utils/errors');
const { objectIdSchema } = require('../utils/validations');

// No hay login en el workshop: el usuario se identifica con el header
// x-user-id. Aquí se valida que exista en la colección users.
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

module.exports = { requireUser };
