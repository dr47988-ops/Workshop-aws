const { requireEventMutationAdmin } = require('../services/userService');
const { updateEvent } = require('../services/eventService');

const {
    response,
    handleError,
    AppError
} = require('../utils/errors');

exports.handler = async (event) => {
    try {
        await requireEventMutationAdmin(event);
        const id = event.pathParameters?.id;

        let body;

        try {
            body = JSON.parse(event.body || '{}');
        } catch {
            throw new AppError('Formato JSON inválido', 400);
        }

        const result = await updateEvent(id, body);

        return response(200, {
            success: true,
            message: 'Evento actualizado correctamente',
            data: result
        });

    } catch (error) {
        return handleError(error);
    }
};