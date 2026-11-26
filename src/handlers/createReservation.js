const { createReservation } = require('../services/reservationService');
const { requireUser } = require('../services/userService');
const { response } = require('../utils/errors');
const { parseBody, getHeader, wrap } = require('../utils/http');

exports.handler = wrap(async (event) => {
    const user = await requireUser(getHeader(event, 'x-user-id'));
    const body = parseBody(event);

    const result = await createReservation(
        event.pathParameters?.id,
        user._id.toString(),
        body
    );

    return response(201, {
        success: true,
        message: 'Reservación creada correctamente',
        data: result
    });
});
