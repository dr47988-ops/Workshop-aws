// Valores configurables por variables de entorno (con valores por defecto).
// Se leen en cada llamada para poder cambiarlos fácilmente en las pruebas.

function taxRate() {
    const rate = Number(process.env.TAX_RATE ?? 0.13);

    return Number.isFinite(rate) && rate >= 0 ? rate : 0.13;
}

function reservationTtlMinutes() {
    const minutes = Number(process.env.RESERVATION_TTL_MINUTES ?? 15);

    return Number.isFinite(minutes) && minutes > 0 ? minutes : 15;
}

module.exports = { taxRate, reservationTtlMinutes };
