const { getEvent } = require('../services/eventService');
const { response, handleError } = require('../utils/errors');

exports.handler = async (event) => {
    try {
        const id = event.pathParameters?.id;

        const result = await getEvent(id);

        return response(200, {
            success: true,
            data: result
        });

    } catch (error) {
        return handleError(error);
    }
};