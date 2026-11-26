const { createCategory } = require('../services/categoryService');
const { response, handleError, AppError } = require('../utils/errors');

exports.handler = async (event) => {
    try {
        let body;
        try {
            body = JSON.parse(event.body || '{}');
        } catch {
            throw new AppError('Formato JSON inválido', 400);
        }

        const data = await createCategory(body);
        return response(201, { success: true, data });
    } catch (error) {
        return handleError(error);
    }
};
