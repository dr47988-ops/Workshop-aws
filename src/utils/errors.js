class AppError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

function response(statusCode, data) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    };
}

// Convierte los errores que no son AppError en una respuesta con sentido.
function normalizeError(error) {
    if (error.statusCode) {
        return error;
    }

    if (error.code === 11000) {
        return new AppError('Ya existe un registro con esos datos', 409);
    }

    if (error.name === 'BSONError') {
        return new AppError('ID inválido', 400);
    }

    return error;
}

function handleError(error) {
    const normalized = normalizeError(error);

    if (normalized.statusCode) {
        console.error(normalized.message);
    } else {
        console.error(error);
    }

    return response(normalized.statusCode || 500, {
        success: false,
        message: normalized.statusCode
            ? normalized.message
            : 'Error interno del servidor'
    });
}

module.exports = {
    AppError,
    response,
    handleError
};
