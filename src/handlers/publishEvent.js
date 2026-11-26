const { publishEvent } = require('../services/eventService');
const { response, handleError } = require('../utils/errors');

exports.handler = async (event) => {
    try {
        const data = await publishEvent(event.pathParameters?.id);
        return response(200, { success: true, data });
    } catch (error) {
        return handleError(error);
    }
};
