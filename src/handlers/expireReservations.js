const { expireDueReservations } = require('../services/reservationService');
const { authenticate, requireRole } = require('./auth');
const { response } = require('../utils/errors');
const { wrap } = require('../utils/http');

exports.handler = wrap(async event => {
    if (event.source === 'aws.events') {
        const expired = await expireDueReservations();
        console.log(`Reservaciones expiradas: ${expired}`);
        return { expired };
    }

    const { user } = await authenticate(event);
    requireRole(user, 'ADMIN');
    return response(200, { success: true, data: { expired: await expireDueReservations() } });
});
