# Workshop-aws

[Persona 1 — Autenticación, usuarios y pruebas locales](AUTENTICACION.md)
workshop

## Entregable anterior · Categorías y administración de eventos

| Método y ruta | Handler de Lambda | Resultado |
| --- | --- | --- |
| `POST /categories` | `src/handlers/createCategory.handler` | `201` con la categoría creada |
| `GET /categories` | `src/handlers/listCategories.handler` | `200` con las categorías activas ordenadas por nombre |
| `PATCH /events/{id}/publish` | `src/handlers/publishEvent.handler` | `200` con el evento publicado |
| `DELETE /events/{id}` | `src/handlers/deleteEvent.handler` | `200` con el evento marcado como eliminado |

Para crear una categoría, enviá un cuerpo JSON como `{"name":"Música","description":"Conciertos"}`. El nombre es obligatorio y único sin distinguir mayúsculas de minúsculas. Usá el `_id` devuelto como `categoryId` al crear o editar un evento.

Para publicar, el evento debe estar en `DRAFT`, tener fecha futura, una categoría activa y al menos un tipo de entrada válido. La publicación registra `publishedAt`. La eliminación lógica registra `isDeleted: true` y `deletedAt`. El evento permanece en MongoDB y queda fuera del listado y la consulta por ID.

## Configuración y evidencia local

Configurá `MONGODB_URI` y `DB_NAME` según `.env.example`. Usá MongoDB Atlas o un replica set local. Ejecutá `node create-indexes.js` antes de habilitar las rutas. Este comando crea la colección `categories` si hace falta y aplica el índice único de nombre. Si ya existen nombres duplicados según la colación del índice, resolvé esos duplicados antes de volver a ejecutar el comando.

```sh
npm ci
node create-indexes.js
node test-persona2.js
```

La prueba crea y elimina una base temporal con nombre aleatorio en la instancia indicada por `MONGODB_URI`. Usá una instancia de desarrollo con permisos para ambas operaciones.

Ejecución local con MongoDB 8.3:

```text
Categorías: POST 201, duplicado 409, JSON inválido 400, GET 200 y registro persistido.
Publicación: referencia ObjectId verificada, fecha vencida 409, PATCH 200 y PUBLISHED persistido.
Eliminación lógica: DELETE 200, documento conservado, excluido del listado y GET 404.
```

También se ejecutaron `node create-indexes.js` y la prueba básica existente `node test-events.js` en la instancia local.

## Integrantes 2 y 3 · Automatización y reservaciones avanzadas

Configurá los dos secretos JWT según [AUTENTICACION.md](AUTENTICACION.md) y ejecutá `npm ci`, `npm run indexes` y `node local-server.js`. MongoDB debe soportar transacciones (Atlas o un replica set). El script de índices prepara las colecciones y garantiza la unicidad de las claves de idempotencia y de las tareas equivalentes. Usá `npm test` contra una instancia de desarrollo con permisos para crear y eliminar bases temporales.

Registrá una cuenta con `POST /auth/register`. Para las operaciones administrativas, asigná el rol `ADMIN` a una cuenta autorizada en la colección `users` y usá su token de acceso. Todas las rutas de la tabla, las reservaciones existentes y las operaciones de edición o eliminación de eventos reciben `Authorization: Bearer <accessToken>`. La opción `WORKSHOP_LOCAL_LEGACY=true` mantiene los identificadores de prueba `x-user-id` y el acceso anterior a edición y eliminación de eventos exclusivamente para pruebas locales aisladas.

| Método y ruta | Entrada y comportamiento |
| --- | --- |
| `POST /events/{id}/reminders` | ADMIN. Cuerpo con `minutesBefore` entero y `message`. Programa el aviso antes del evento. |
| `GET /events/{id}/reminders` | ADMIN. Últimos 100 recordatorios y sus estados. |
| `PATCH /reminders/{id}` | ADMIN. Cambia `minutesBefore`, `message` o ambos mientras la tarea está pendiente. |
| `DELETE /reminders/{id}` | ADMIN. Cancela el recordatorio pendiente y conserva su registro. |
| `POST /events/{id}/announcements` | ADMIN. Recibe `message` y encola un anuncio de un evento publicado. |
| `GET /events/{id}/announcements` | ADMIN o usuario con reservación activa para el evento. |
| `POST /notifications/process` | ADMIN. Procesa hasta 25 tareas vencidas y devuelve los conteos de tareas y entregas. Se puede invocar repetidamente. |
| `GET /users/me/notifications?cursor=<id>` | Hasta 100 entregas simuladas propias, recientes primero. Para avanzar, usá el último `_id` como cursor. |
| `PATCH /reservations/{id}/confirm` | Titular. Confirma una reservación pendiente vigente y conserva el inventario tomado. Una segunda confirmación devuelve el estado confirmado. |
| `PATCH /reservations/{id}/cancel` | Titular. Cancela una reservación pendiente vigente o confirmada y libera el inventario una vez. |
| `POST /reservations/expire` | ADMIN. Procesa hasta 100 reservaciones pendientes vencidas. La programación de expiración existente también funciona en AWS. |

El procesamiento de notificaciones se invoca por HTTP. Cada tarea registra una entrega simulada por usuario con reservación confirmada o pendiente vigente al procesarla. Si se cambia la fecha del evento se recalculan los recordatorios pendientes. Editar un evento publicado encola un aviso si cambian datos. Cancelar o eliminar un evento publicado encola un aviso de cancelación y cancela sus recordatorios pendientes.

En `POST /events/{id}/reservations` podés enviar `Idempotency-Key` con hasta 128 caracteres ASCII imprimibles sin espacios. Una clave se aplica al usuario en todas sus solicitudes de creación. Repetir la misma solicitud devuelve el `201` y el cuerpo original. Reutilizarla con un evento o cantidades diferentes devuelve `409`. Se permite una reservación activa por usuario y evento. El plazo de una reservación pendiente termina al cumplirse el TTL o cuando inicia el evento, lo que ocurra primero. La API devuelve el historial de transiciones registradas.

La colección [Workshop Serverless](postman/Workshop-Serverless.postman_collection.json) incluye las rutas nuevas. Para correrla completa, configurá `adminEmail` y `adminPassword` como variables de entorno de Postman y corré la colección en orden. La colección registra su propio participante, crea un evento de prueba y lo elimina al final. Los escenarios automatizados prueban el CRUD, envío simulado, deduplicación, rollback, expiración y la concurrencia de diez compradores por cinco entradas.
