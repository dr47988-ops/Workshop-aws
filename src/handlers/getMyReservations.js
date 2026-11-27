const { listUserReservations } = require('../services/reservationService');
const { requireReservationUser } = require('../services/userService');
const { response } = require('../utils/errors');
const { wrap } = require('../utils/http');

exports.handler = wrap(async (event) => {
    const user = await requireReservationUser(event);

    const result = await listUserReservations(
        user._id.toString(),
        event.queryStringParameters || {}
    );

    return response(200, { success: true, ...result });
});
