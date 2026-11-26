const { listEvents } = require('../services/eventService');
const { response, handleError } = require('../utils/errors');

exports.handler = async (event) => {
    try {
        const query = event.queryStringParameters || {};

        const result = await listEvents(query);

        return response(200, {
            success: true,
            ...result
        });

    } catch (error) {
        return handleError(error);
    }
};