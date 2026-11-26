const { listUserReservations } = require('../services/reservationService');
const { requireUser } = require('../services/userService');
const { response } = require('../utils/errors');
const { getHeader, wrap } = require('../utils/http');

exports.handler = wrap(async (event) => {
    const user = await requireUser(getHeader(event, 'x-user-id'));

    const result = await listUserReservations(
        user._id.toString(),
        event.queryStringParameters || {}
    );

    return response(200, { success: true, ...result });
});
