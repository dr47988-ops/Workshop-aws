const { expireDueReservations } = require('../services/reservationService');
const { wrap } = require('../utils/http');

// No pertenece a ningún endpoint: lo invoca EventBridge cada minuto para
// liberar las entradas de las reservaciones que superaron los 15 minutos.
exports.handler = wrap(async () => {
    const expired = await expireDueReservations();

    console.log(`Reservaciones expiradas: ${expired}`);

    return { expired };
});
