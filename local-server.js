// Servidor local que imita a API Gateway para probar las funciones Lambda
// con Postman sin desplegar nada:  node local-server.js
const http = require('node:http');

const routes = [
    ['POST', '/auth/register', 'auth'],
    ['POST', '/auth/login', 'auth'],
    ['GET', '/users/me', 'auth'],
    ['PATCH', '/users/me', 'auth'],
    ['POST', '/auth/refresh', 'auth'],
    ['POST', '/auth/logout', 'auth'],
    ['GET', '/events', 'listEvents'],
    ['GET', '/events/{id}', 'getEvent'],
    ['POST', '/events', 'createEvent'],
    ['PATCH', '/events/{id}', 'updateEvent'],
    ['DELETE', '/events/{id}', 'deleteEvent'],
    ['PATCH', '/events/{id}/publish', 'publishEvent'],
    ['GET', '/categories', 'listCategories'],
    ['POST', '/categories', 'createCategory'],
    ['POST', '/events/{id}/reservations', 'createReservation'],
    ['GET', '/reservations/{id}', 'getReservation'],
    ['PATCH', '/reservations/{id}/cancel', 'cancelReservation'],
    ['GET', '/users/me/reservations', 'getMyReservations']
].map(([method, path, name]) => ({
    method,
    name,
    regex: new RegExp('^' + path.replace('{id}', '([^/]+)') + '$'),
    handler: require(`./src/handlers/${name}`).handler
}));

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = routes.find(item =>
        item.method === req.method && item.regex.test(url.pathname)
    );

    const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };

    if (!route) {
        return send(404, { message: 'Not Found' });
    }

    let body = '';
    for await (const chunk of req) body += chunk;

    const match = url.pathname.match(route.regex);
    const result = await route.handler({
        routeKey: `${req.method} ${url.pathname}`,
        headers: req.headers,
        pathParameters: match[1] ? { id: match[1] } : undefined,
        queryStringParameters: Object.fromEntries(url.searchParams),
        body: body || undefined
    });

    send(result.statusCode, result.body);
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`API local en http://localhost:${port}`));
