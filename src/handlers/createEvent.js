const { createEvent } = require('../services/eventService');

const {
    response,
    handleError,
    AppError
} = require('../utils/errors');

exports.handler = async (event) => {
    try {
        let body;

        try {
            body = JSON.parse(event.body || '{}');
        } catch {
            throw new AppError('Formato JSON inválido', 400);
        }

        const result = await createEvent(body);

        return response(201, {
            success: true,
            message: 'Evento creado correctamente',
            data: result
        });

    } catch (error) {
        return handleError(error);
    }
};