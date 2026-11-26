const { AppError, handleError } = require('./errors');

function parseBody(event) {
    try {
        return JSON.parse(event.body || '{}');
    } catch {
        throw new AppError('Formato JSON inválido', 400);
    }
}

// API Gateway HTTP API entrega los headers en minúscula,
// pero se busca sin distinguir mayúsculas por si se prueba a mano.
function getHeader(event, name) {
    const headers = event.headers || {};
    const key = Object.keys(headers)
        .find(header => header.toLowerCase() === name.toLowerCase());

    return key ? headers[key] : undefined;
}

// Envuelve un handler para que todos los errores salgan por el mismo lugar.
function wrap(callback) {
    return async (event) => {
        try {
            return await callback(event || {});
        } catch (error) {
            return handleError(error);
        }
    };
}

module.exports = { parseBody, getHeader, wrap };
