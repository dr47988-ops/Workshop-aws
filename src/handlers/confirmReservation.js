const { confirmReservation } = require('../services/reservationService');
const { requireReservationUser } = require('../services/userService');
const { response } = require('../utils/errors');
const { wrap } = require('../utils/http');

exports.handler = wrap(async event => {
    const user = await requireReservationUser(event);
    const data = await confirmReservation(event.pathParameters?.id, user._id);
    return response(200, { success: true, data });
});
