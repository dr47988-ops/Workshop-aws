const { authenticate, requireRole } = require('./auth');
const service = require('../services/notificationService');
const { AppError, response } = require('../utils/errors');
const { parseBody, wrap } = require('../utils/http');

const routes = {
    'POST /events/{id}/reminders': [201, true, (event, id) => service.create('REMINDER', id, parseBody(event))],
    'GET /events/{id}/reminders': [200, true, (event, id, user) => service.list('REMINDER', id, user)],
    'PATCH /reminders/{id}': [200, true, (event, id) => service.editReminder(id, parseBody(event))],
    'DELETE /reminders/{id}': [200, true, (event, id) => service.editReminder(id, undefined, true)],
    'POST /events/{id}/announcements': [201, true, (event, id) => service.create('ANNOUNCEMENT', id, parseBody(event))],
    'GET /events/{id}/announcements': [200, false, (event, id, user) => service.list('ANNOUNCEMENT', id, user)],
    'POST /notifications/process': [200, true, () => service.processPending()],
    'GET /users/me/notifications': [200, false, (event, id, user) =>
        service.history(user._id, event.queryStringParameters?.cursor)]
};

exports.handler = wrap(async event => {
    if (!Object.hasOwn(routes, event.routeKey)) throw new AppError('Ruta no encontrada', 404);
    const { user } = await authenticate(event);
    const [status, adminOnly, execute] = routes[event.routeKey];
    if (adminOnly) requireRole(user, 'ADMIN');
    const data = await execute(event, event.pathParameters?.id, user);
    return response(status, { success: true, data });
});
