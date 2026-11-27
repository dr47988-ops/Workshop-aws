const { requireEventMutationAdmin } = require('../services/userService');
const { deleteEvent } = require('../services/eventService');
const { response, handleError } = require('../utils/errors');

exports.handler = async (event) => {
    try {
        await requireEventMutationAdmin(event);
        const data = await deleteEvent(event.pathParameters?.id);
        return response(200, { success: true, data });
    } catch (error) {
        return handleError(error);
    }
};
