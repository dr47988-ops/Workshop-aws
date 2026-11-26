# Workshop-aws
workshop

## Persona 2 — Categorías y administración de eventos

| Método y ruta | Handler de Lambda | Resultado |
| --- | --- | --- |
| `POST /categories` | `src/handlers/createCategory.handler` | `201` con la categoría creada |
| `GET /categories` | `src/handlers/listCategories.handler` | `200` con las categorías activas ordenadas por nombre |
| `PATCH /events/{id}/publish` | `src/handlers/publishEvent.handler` | `200` con el evento publicado |
| `DELETE /events/{id}` | `src/handlers/deleteEvent.handler` | `200` con el evento marcado como eliminado |

Para crear una categoría, enviá un cuerpo JSON como `{"name":"Música","description":"Conciertos"}`. El nombre es obligatorio y único sin distinguir mayúsculas de minúsculas. Usá el `_id` devuelto como `categoryId` al crear o editar un evento.

Para publicar, el evento debe estar en `DRAFT`, tener fecha futura, una categoría activa y al menos un tipo de entrada válido. La publicación registra `publishedAt`. La eliminación lógica registra `isDeleted: true` y `deletedAt`. El evento permanece en MongoDB y queda fuera del listado y la consulta por ID.

## Configuración y evidencia local

Configurá `MONGODB_URI` y `DB_NAME` según `.env.example`. Ejecutá `node create-indexes.js` antes de habilitar las rutas. Este comando crea la colección `categories` si hace falta y aplica el índice único de nombre. Si ya existen nombres duplicados según la colación del índice, resolvé esos duplicados antes de volver a ejecutar el comando.

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
