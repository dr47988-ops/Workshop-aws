const { listCategories } = require('../services/categoryService');
const { response, handleError } = require('../utils/errors');

exports.handler = async () => {
    try {
        const data = await listCategories();
        return response(200, { success: true, data });
    } catch (error) {
        return handleError(error);
    }
};
