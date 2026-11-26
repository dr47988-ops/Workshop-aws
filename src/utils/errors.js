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

function handleError(error) {
    console.error(error.message);

    return response(error.statusCode || 500, {
        success: false,
        message: error.statusCode
            ? error.message
            : 'Error interno del servidor'
    });
}

module.exports = {
    AppError,
    response,
    handleError
};