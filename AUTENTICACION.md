# Entregable 2 — Persona 1

Ejecuta `npm ci` y configura `MONGODB_URI`, `DB_NAME`, `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` en tu entorno local o en un archivo `.env` excluido de Git. Usa dos secretos aleatorios distintos de 32 caracteres o más. Usa una base de pruebas separada de producción.

Inicia `node local-server.js`. En Postman, usa `http://localhost:3000` como `baseUrl` y ejecuta la carpeta Persona 1 en orden.

- Registro recibe `name`, `email` y `password`, y asigna `PARTICIPANT`.
- Login recibe `email` y `password`. Envía el access token como `Authorization: Bearer <token>` en las rutas de perfil.
- PATCH de perfil recibe `name`. Los campos adicionales, incluido `role`, se rechazan.
- Refresh y logout reciben `refreshToken`. Refresh lo rota en forma atómica. Logout revoca toda esa sesión, incluidos sus access tokens.
- El access token dura hasta 15 minutos y la sesión hasta siete días. La caducidad se valida antes de usar la sesión, independientemente de la limpieza TTL de MongoDB.

Los usuarios de demostración existentes no tienen contraseña. Las rutas del Entregable 1 conservan su contrato anterior. Antes de exponer operaciones del Entregable 2 que gestionen otros recursos, integra los controles de rol y propiedad en sus handlers.

En AWS quedan pendientes `sam build`, la provisión segura de los parámetros `JwtAccessSecret` y `JwtRefreshSecret`, el despliegue y las pruebas de la HTTP API. MongoDB debe permitir al usuario de la aplicación acceder a `users` y `authSessions` y crear sus índices.
