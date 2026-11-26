const { z } = require('zod');
const repository = require('../repositories/categoryRepository');
const { AppError } = require('../utils/errors');
const { validate } = require('../utils/validations');

const categorySchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional()
}).strict();

async function createCategory(body) {
    const data = validate(categorySchema, body);
    const now = new Date();

    try {
        return await repository.create({
            ...data,
            isDeleted: false,
            createdAt: now,
            updatedAt: now
        });
    } catch (error) {
        if (error.code === 11000) {
            throw new AppError('Ya existe una categoría con ese nombre', 409);
        }
        throw error;
    }
}

module.exports = { createCategory, listCategories: repository.findAll };
