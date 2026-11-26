const { z } = require('zod');
const { AppError } = require('./errors');

const objectIdSchema = z.string().regex(
    /^[a-fA-F0-9]{24}$/,
    'ID inválido'
);

const ticketSchema = z.object({
    name: z.string().trim().min(1),
    price: z.number().nonnegative(),
    capacity: z.number().int().positive()
});

const eventSchema = z.object({
    title: z.string().trim().min(3),
    description: z.string().trim().min(5),
    categoryId: objectIdSchema,
    location: z.string().trim().min(3),
    date: z.string().refine(
        value => !isNaN(Date.parse(value)),
        'Fecha inválida'
    ),
    ticketTypes: z.array(ticketSchema).min(1)
}).strict();

const updateEventSchema = eventSchema
    .omit({ ticketTypes: true })
    .partial()
    .extend({
        status: z.enum(['CANCELLED', 'COMPLETED']).optional()
    })
    .refine(
        data => Object.keys(data).length > 0,
        'Debe proporcionar datos para actualizar'
    );

function validate(schema, data) {
    const result = schema.safeParse(data);

    if (!result.success) {
        throw new AppError(
            result.error.issues
                .map(issue => issue.message)
                .join(', '),
            400
        );
    }

    return result.data;
}

module.exports = {
    objectIdSchema,
    eventSchema,
    updateEventSchema,
    validate
};
const reservationSchema = z.object({
    items: z.array(
        z.object({
            ticketTypeId: objectIdSchema,
            quantity: z.number(
                'La cantidad debe ser un número'
            ).int('La cantidad debe ser un entero')
                .min(1, 'La cantidad mínima es 1')
                .max(10, 'La cantidad máxima por tipo de entrada es 10')
        }).strict()
    ).min(1, 'Debe reservar al menos una entrada')
        .max(10, 'Demasiados tipos de entrada en una reservación')
}).strict();

module.exports.reservationSchema = reservationSchema;
