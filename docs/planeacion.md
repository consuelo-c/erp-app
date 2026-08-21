# Planeación — Aplicación de Pedidos (Alquiler de Muebles para Eventos)

**Versión 4** · Documento único de referencia para la construcción con Claude Code.

> **Estado del documento:** especificación completa y vigente. Este bloque describe el estado actual, no el historial de cambios; ante cualquier duda, manda el cuerpo del documento.
>
> Puntos que definen la aplicación: **13 tablas** en D1 · capa de servicios con actor resuelto (2.8) · **PWA completa desde la fase 0** (12.2) · la landing `/` es la consulta del cliente, entregada primero como logo + enlace "Empleados" (17) · permisos en tres niveles con transiciones operativas abiertas (3.3) · ciclo de pedidos ramificado por método de entrega (6.2) · variantes de producto sin fila padre (5.5) · novedades con desenlace por producto (5.9, 13) · conteos parciales frecuentes con varios pendientes (14) · **las horas extras se derivan del registro de horas** (15.3) y la nómina es la fase 4 (16) · toda la plata en `cash_movements` inmutable (5.7, 8) · tres formatos impresos: pedido (10.2), comprobante de nómina (16.8) y recibo de caja (8.6) · notificaciones por Mailgun, WhatsApp diferido (18) · dinero en pesos enteros con redondeo por línea (16.5).
---

## 1. Contexto y objetivo

Aplicación web para el registro y seguimiento de pedidos de una empresa que alquila sillas, mesas, mantelería, cristalería y cubiertos para eventos (matrimonios, cumpleaños, fiestas).

- **Uso interno**, equipo pequeño (~5 personas). No es una aplicación pública salvo por la consulta de estado del cliente.
- **Volumen:** entre 5 y 10 pedidos por día. Catálogo de máximo 60 productos.
- **No se generan reportes agregados** por trimestre, semestre ni año.

Estas tres características justifican varias decisiones técnicas deliberadamente simples que se documentan más abajo. No son descuidos.

---

## 2. Stack y decisiones técnicas

| Aspecto | Decisión |
|---|---|
| Framework | SvelteKit (`adapter-cloudflare`) |
| Despliegue | Cloudflare Workers / Pages |
| Base de datos | **Cloudflare D1 (SQLite)** |
| ORM y migraciones | **Drizzle** + `drizzle-kit generate` → `wrangler d1 migrations apply` |
| Almacenamiento de imágenes | Cloudflare R2 (fotos de novedades) |
| Autenticación | Implementación propia de sesiones |
| Hashing de contraseñas | PBKDF2-SHA256 vía WebCrypto (~600.000 iteraciones) |
| Validación de datos | Zod |
| Zona horaria de operación | `America/Bogota` (UTC−5 fijo, sin horario de verano) |
| Moneda | Peso colombiano, enteros sin decimales |

### 2.1 Por qué D1 y qué implica

D1 es SQLite. **No existen** los tipos `uuid`, `jsonb`, `timestamp`, `time`, `date`, `enum` ni `boolean`. Todo se mapea así:

| Concepto | Tipo en D1 | Convención |
|---|---|---|
| Identificador | `INTEGER PRIMARY KEY AUTOINCREMENT` | excepto `sessions` y `holidays` |
| Fecha civil | `TEXT` | `YYYY-MM-DD` |
| Hora civil | `TEXT` | `HH:MM` (24h) |
| Instante | `INTEGER` | epoch en segundos, UTC |
| Booleano | `INTEGER` | `0` / `1` |
| Enumeración | `TEXT` | con `CHECK (campo IN (...))` |
| Dinero | `INTEGER` | pesos enteros. **Nunca `REAL`** |
| Estructura JSON | `TEXT` | validado con Zod al leer y al escribir |

### 2.2 Sin transacciones

D1 **no soporta transacciones interactivas**. `BEGIN TRANSACTION` falla. Solo existe `batch()`, que ejecuta varias sentencias de forma atómica pero no permite intercalar lógica JavaScript entre ellas.

**Esta aplicación no usa transacciones en absoluto.** La única operación que en teoría las necesitaría —validar disponibilidad de inventario al confirmar un pedido— fue rediseñada para no requerirlas (ver sección 9).

Consecuencia práctica: como los ítems de un pedido viven dentro de la misma fila, crear un pedido completo es un solo `INSERT`.

### 2.3 Sin rollback de migraciones

D1 no tiene rollback. Deshacer un cambio de esquema requiere una migración nueva. Además, SQLite tiene `ALTER TABLE` muy limitado: cambiar el tipo de una columna, agregar un `CHECK` o modificar una llave foránea obliga a **recrear la tabla y copiar los datos**.

Por eso las tablas núcleo (`users`, `clients`, `products`, `orders`) se definen completas en la fase 0, aunque se llenen después.

### 2.4 Nomenclatura

**Todo el código va en inglés**: nombres de funciones, variables, columnas y **valores de las enumeraciones**. La documentación y la interfaz de usuario van en español.

Helpers de permisos y sesión:

```
requireRole(locals, roles)
hasRole(user, role)
hasAnyRole(user, roles)
isAdmin(user)
isAdminOrManager(user)
```

Como los valores almacenados están en inglés y la UI está en español, **se necesita un mapa de traducción para mostrarlos**. Es obligatorio de todos modos: `OUT_FOR_DELIVERY` no es texto presentable a un usuario.

```js
// src/lib/labels.ts
export const ORDER_STATUS_LABELS = {
  DRAFT:            'Borrador',
  CONFIRMED:        'Confirmado',
  PICKED:           'Separado',
  OUT_FOR_DELIVERY: 'En ruta de entrega',
  DELIVERED:        'Entregado',
  OUT_FOR_PICKUP:   'En ruta de recogida',
  COMPLETED:        'Completado',
  CANCELLED:        'Cancelado'
}

export const ROLE_LABELS = {
  ADMIN:     'Administrador',
  MANAGER:   'Gerente',
  SALES:     'Ventas',
  WAREHOUSE: 'Bodega',
  DRIVER:    'Conductor'
}

export const CASH_CONCEPT_LABELS = {
  INSTALLMENT:        'Abono',
  SECURITY_DEPOSIT:   'Depósito de garantía',
  INSTALLMENT_REFUND: 'Devolución de abono',
  DEPOSIT_REFUND:     'Devolución de depósito',
  PAYROLL:            'Pago de nómina',
  CARRIER_PAYMENT:    'Pago a transportador',
  OTHER_EXPENSE:      'Otro egreso'
}

export const PAYMENT_METHOD_LABELS = {
  CASH:     'Efectivo',
  TRANSFER: 'Transferencia',
  OTHER:    'Otro'
}

export const DELIVERY_METHOD_LABELS = {
  COMPANY_DELIVERY: 'Entrega la empresa',
  CLIENT_PICKUP:    'Recoge el cliente',
  EXTERNAL_CARRIER:   'Transportador externo'
}

export const RETURN_METHOD_LABELS = {
  COMPANY_PICKUP:  'Recoge la empresa',
  CLIENT_RETURN:   'Devuelve el cliente',
  EXTERNAL_CARRIER:  'Transportador externo'
}

export const RESPONSIBLE_PARTY_LABELS = {
  UNDETERMINED: 'Por determinar',
  CLIENT:       'Cliente',
  CARRIER:      'Transportador',
  COMPANY:      'La empresa'
}

export const CATEGORY_LABELS = {
  CHAIRS_TABLES: 'Sillas y mesas',
  LINENS:        'Manteles y ruches',
  GLASSWARE:     'Cristalería',
  CUTLERY:       'Cubiertos',
  TABLEWARE:     'Platos y vajilla',
  CHAFERS_TRAYS: 'Samovares y bandejas',
  DECOR:         'Decoración'
}
```

**Regla:** ningún componente construye etiquetas a mano ni deja escapar un valor crudo a la pantalla. Todo pasa por este mapa.

### 2.5 Manejo de zona horaria

Los Workers corren en UTC. Esto es fuente de errores de un día completo.

El helper es **genérico por zona horaria**:

```ts
// src/lib/datetime.ts
export const COMPANY_TIMEZONE = 'America/Bogota'

/** Fecha actual (YYYY-MM-DD) en la zona horaria indicada. */
export function getTodaysDate(timeZone: string): string
```

**Regla crítica:** aunque el helper acepte cualquier zona, **toda la lógica de negocio pasa siempre `COMPANY_TIMEZONE`**. La zona del visitante solo puede usarse para presentación.

Si un cliente consulta desde España a las 7 p.m. (mediodía en Medellín) y se calculara "hoy" con su zona, el resultado sería un día distinto y las listas de despacho quedarían mal.

**Reglas duras adicionales:**

1. **Prohibido** `new Date().toISOString().slice(0,10)` en cualquier parte del código. Entre las 7 p.m. y la medianoche devuelve el día siguiente.
2. **Prohibido** usar `date('now')` o `datetime('now')` de SQLite para lógica de negocio: devuelven UTC. La fecha se calcula en JS y se pasa como parámetro.
3. Los valores de `<input type="date">` ya vienen como `YYYY-MM-DD` y se pasan **tal cual** a la base de datos. No se convierten a `Date` ni de ida ni de vuelta.
4. `COMPANY_TIMEZONE` se define en un solo archivo y nunca se escribe la cadena literal en otro lado.

Las fechas y horas de negocio (evento, entrega, recogida, marcas de horario) **no llevan zona horaria**: son fechas y horas civiles. Solo `created_at`, `updated_at` y `expires_at` son instantes reales en UTC.

### 2.6 Auditoría

**Las trece tablas llevan el mismo bloque de auditoría:**

```sql
created_at  INTEGER NOT NULL,
created_by  TEXT    NOT NULL,   -- email del usuario
updated_at  INTEGER NOT NULL,
updated_by  TEXT    NOT NULL    -- email del usuario
```

Decisiones asociadas:

- **`created_by` y `updated_by` son TEXT con el email**, no llaves foráneas. Es coherente con el resto del documento, donde ya se guardan `client_name`, `list_price` y los nombres de producto como snapshot: el rastro de auditoría no debe depender de datos que pueden cambiar después, y un email en texto plano es legible incluso en un volcado crudo de la base.
- **Todos los campos de "quién hizo qué" son TEXT con email**: `reversed_by`, `reviewed_by`, `paid_by`. La única excepción es `timesheets.user_id`, que **sí es llave foránea** porque no es auditoría sino dato de negocio: identifica de quién son esas horas.
- En un `INSERT`, `updated_at` = `created_at` y `updated_by` = `created_by`.
- Los registros que crea el seed usan el valor centinela **`system@seed`**.
- **Implementación:** las columnas de auditoría se llenan en una capa común (helper de escritura o `$onUpdate` de Drizzle), no manualmente en cada consulta. Si se dejan al criterio de cada endpoint, tarde o temprano alguna se olvida.

### 2.7 Almacenamiento de fotos en R2

Las fotos (productos y novedades) viven en R2, con estas reglas:

- **El bucket nunca es público.** No hay URLs públicas ni dominios conectados al bucket.
- **La subida pasa por el Worker**, detrás de `requireRole`: se valida MIME de imagen (`image/jpeg`, `image/png`, `image/webp`) y un máximo de **5 MB** antes de escribir.
- **La lectura también**: un endpoint autenticado hace stream desde R2. Quien no tiene sesión no ve fotos.
- Las llaves llevan prefijo por tipo: `products/…`, `incidents/…`.

**Retención.** Las fotos de novedades se conservan **un año**. No se implementa borrado en código: se configura una **regla de ciclo de vida de R2** que elimina los objetos bajo el prefijo `incidents/` a los 365 días. Las de productos, bajo `products/`, no llevan regla y permanecen.

> **Se evaluó guardar las fotos en Google Drive y se descartó.** El motivo era aprovechar una suscripción de Google One, pero **R2 ya sale gratis a este volumen**: unas tres novedades semanales con tres fotos de 3 MB dan ~1,4 GB al año, y con la regla de un año el acumulado se estabiliza por debajo de 2 GB, contra 10 GB gratuitos y sin cobro de egreso.
>
> A cambio, Drive costaría: OAuth con cuenta de servicio (firmar un JWT con RS256, canjearlo, cachear y renovar el token), subida multiparte, y proxy para mostrar cada foto — unas doscientas líneas delicadas en vez de dos llamadas al binding. Más una credencial privada nueva y un punto de falla fuera de la cuenta que ya sostiene la base y el despliegue.

### 2.8 Arquitectura: capa de servicios y actor resuelto

**Toda la lógica de negocio vive en `src/lib/server/services/`, nunca dentro de los form actions ni de los `load` de SvelteKit.**

Las rutas de SvelteKit son **un transporte más**, y una capa delgada: reciben la petición, resuelven el actor, llaman al servicio y renderizan. No calculan totales, no validan fechas, no deciden transiciones de estado.

```ts
// src/lib/server/services/orders.ts
createOrder(input: OrderInput, actor: Actor): Promise<Order>
updateOrder(id: number, input: OrderInput, actor: Actor): Promise<Order>
transitionOrder(id: number, toStatus: OrderStatus, actor: Actor): Promise<Order>
cancelOrder(id: number, reason: string, actor: Actor): Promise<Order>

// src/lib/server/services/inventory.ts
checkAvailability(productId: number, from: string, to: string): Promise<number>
```

#### El actor

```ts
type Actor = {
  email: string                          // alimenta created_by / updated_by
  roles: Role[]
  kind: 'user' | 'system' | 'agent' | 'integration'
}
```

`Actor` unifica los cuatro orígenes posibles de una escritura: un empleado con sesión, el seed (`system@seed`), un agente de IA, y una integración externa. Las columnas de auditoría de la sección 2.6 se llenan siempre desde `actor.email`, así que en el historial se distingue quién —o qué— creó cada pedido.

**`requireRole` recibe un actor ya resuelto, no `locals`:**

```ts
requireRole(actor: Actor, roles: Role[]): void
```

Resolver el actor y verificar sus permisos son dos pasos distintos. El primero depende del transporte (cookie, token); el segundo no debe saber nada de transporte.

#### Por qué esta separación importa

Hay **dos transportes adicionales previstos**, ninguno de los cuales se construye ahora:

1. **Servidor MCP** — recibir pedidos desde un agente de IA.
2. **Webhooks desde WordPress** — el sitio actual de la empresa corre WooCommerce y puede enviar cotizaciones a un endpoint REST.

En ambos casos la lógica de negocio es exactamente la misma: los mismos totales, la misma disponibilidad, las mismas transiciones. Si esa lógica queda escrita dentro de `+page.server.ts`, ninguno de los dos puede reusarla; habría que reimplementarla y las versiones se desincronizarían al primer cambio de precios.

Con la capa de servicios, cada transporte es una envoltura delgada sobre las mismas funciones: recibe la petición, verifica su autenticidad, arma un `Actor` y llama al servicio. **La regla no es "prepararse para MCP", es que ningún transporte contenga lógica de negocio.**

Hoy esta decisión no cuesta nada; después cuesta una reescritura.

#### Lo que habría que agregar cuando se aprueben

**Común a los dos:**

- `orders.source` (`WEB` | `MCP` | `WORDPRESS`) para trazabilidad.
- `orders.external_id` con índice único. Resuelve dos cosas a la vez: **el mapeo** con el pedido de origen y **la idempotencia**. Tanto los agentes como los webhooks reintentan llamadas fallidas, y sin transacciones nada impide que se cree el pedido dos veces.

**Solo para MCP:**

- Tabla `api_tokens` y autenticación por token en vez de cookie.
- Herramientas de solo lectura (buscar productos, consultar disponibilidad, ubicar cliente).

**Solo para los webhooks:**

- Verificación de **firma HMAC** con secreto compartido, guardado con `wrangler secret`. Es un camino de autenticación distinto al de MCP.
- `products.external_id` — WooCommerce tiene sus propios identificadores de producto y el pedido entrante los usará.

#### Dos problemas conocidos, sin resolver

Se documentan ahora para que no sorprendan después. **No hay que resolverlos todavía.**

**Un pedido entrante no puede materializarse completo.** `delivery_date`, `pickup_date`, `rental_days` y `delivery_address` son `NOT NULL`, pero una cotización del sitio web solo trae la fecha del evento y los productos: la fecha de entrega, los días facturados y el transporte los define el vendedor negociando.

La solución es que el pedido entrante **nazca en `DRAFT` con valores por defecto** derivados de lo que sí venga (entrega = fecha del evento, recogida = día siguiente, `rental_days` = 1, transporte = 0), y que el vendedor lo corrija y confirme. Eso preserva el esquema y refleja la operación real: la cotización web es una intención, no un pedido.

La alternativa —hacer esas columnas nullable mientras el pedido esté en `DRAFT`— ensucia todas las lecturas y no se recomienda.

**La llave del cliente no coincide.** Esta app usa `clients.phone UNIQUE` como llave natural; WooCommerce usa el correo. Un pedido del sitio puede llegar con email y sin teléfono, o con el teléfono en otro formato, y `phone` es `NOT NULL UNIQUE`. Habrá que decidir qué hacer con un cliente que no se puede casar con ninguno existente.

**Los precios de esta aplicación siempre mandan.** Si el pedido entrante trae otros valores, se ignoran: se toman productos y cantidades, y los precios se recalculan contra el catálogo. La razón es operativa — al cliente se le llama de todos modos para confirmar el pedido y notificarle el valor final, así que el precio del sitio nunca es el definitivo.

### 2.9 Entornos, CI/CD y despliegue

**Dos entornos — producción y staging — que nunca comparten recursos.** Cada uno tiene su propia base D1 y su propio bucket R2, declarados como bloques `env.production` y `env.staging` en `wrangler.jsonc`. Los bindings no se heredan entre entornos: cada uno los declara completos. El nombre de cada recurso (Worker, base D1, bucket R2) lo decide quien arranca la fase 0; el de staging sigue la convención de sufijo `-staging` sobre el de producción.

**El despliegue es automático vía GitHub Actions, no `wrangler deploy` manual.** El workflow corre en este orden: instalar dependencias → `vitest run` → si los tests pasan, aplicar migraciones de D1 del entorno correspondiente → `wrangler deploy` al entorno correspondiente. Si un test falla, el job se detiene antes de tocar la base de datos o desplegar.

- Push a `main` → despliega a **producción**.
- Push a `staging` → despliega al entorno de **staging**.

**El token que autentica el workflow no es un secreto de `wrangler`, es un secreto de GitHub.** Se crea un API token de Cloudflare con permisos acotados (Workers Scripts, D1, R2 — nunca el token global de cuenta) y se guarda en GitHub → Settings → Secrets, nunca en el repositorio ni en `wrangler.jsonc`. Los secretos que necesita la aplicación en tiempo de ejecución (`MAILGUN_API_KEY`, la contraseña del admin del seed) siguen yendo por `wrangler secret`, sin cambios: son dos superficies de secretos distintas para dos propósitos distintos.

**Staging queda protegido con Cloudflare Access.** Como corre con datos de prueba pero su URL es alcanzable como cualquier otra si no se restringe, se pone detrás de Access (login por correo, plan gratuito hasta 50 usuarios) para que solo el equipo la vea. Producción no lleva Access: su control de acceso es el login propio de la aplicación.

---

## 3. Roles y permisos

### 3.1 Roles

| Valor | Etiqueta | Descripción |
|---|---|---|
| `ADMIN` | Administrador | Acceso y modificación total del sistema |
| `MANAGER` | Gerente | Igual a ADMIN, **excepto** crear/modificar empleados y modificar días festivos (los ve en modo lectura) |
| `SALES` | Ventas | Toma y actualiza pedidos, registra pagos |
| `WAREHOUSE` | Bodega | Alista pedidos y recibe devoluciones. Marca `PICKED` y `COMPLETED` |
| `DRIVER` | Conductor | Transporta. Marca `OUT_FOR_DELIVERY`, `DELIVERED` y `OUT_FOR_PICKUP`. Puede registrar pagos |
| — | Cliente | No es un rol del sistema. No tiene cuenta. Solo consulta el estado de su pedido |

**Un empleado puede tener varios roles.** Con 5 personas es común que alguien sea `WAREHOUSE` y `DRIVER` a la vez, o `MANAGER` y `SALES`.

Consecuencias:

- Los permisos se evalúan con `hasRole()` y `hasAnyRole()`, nunca con igualdad simple.
- La barra lateral muestra **la unión** de las secciones de todos sus roles.
- **Las restricciones cruzadas dejan de aplicar cuando coinciden en una persona.** Si alguien es `WAREHOUSE` y `DRIVER`, puede marcar `PICKED` y también `DELIVERED`. Esto es intencional: no implementar exclusión mutua.

### 3.2 Simplificación de permisos

Como `MANAGER` hace casi todo lo que hace `ADMIN`, no se necesita una matriz granular por acción. Bastan dos verificaciones:

```
isAdmin(user)           → solo empleados y días festivos
isAdminOrManager(user)  → todo el resto del dashboard administrativo
```

### 3.3 Candados duros y permisos abiertos

**Principio:** solo se restringe una acción cuando hay una razón real de separación de funciones (dinero, personal, ajustes de inventario). Todo lo demás queda abierto.

La razón es operativa: son **5 empleados**. Si las transiciones de estado estuvieran amarradas duro al rol, bastaría con que el de bodega se enferme o salga a licencia para que nadie pueda alistar un pedido. Eso no es una salvaguarda, es un punto único de falla.

**Candados duros** — hay motivo:

| Acción | Quién |
|---|---|
| Registrar pagos | `SALES`, `DRIVER`, `MANAGER`, `ADMIN` (bodega **no**) |
| Crear/editar empleados | Solo `ADMIN` |
| Editar días festivos | Solo `ADMIN` |
| Aprobar o reversar conteos | `ADMIN`, `MANAGER` |
| Reversar novedades | `ADMIN`, `MANAGER` |

**Transiciones comerciales** — implican precio y compromiso con el cliente:

| Acción | Quién |
|---|---|
| `DRAFT → CONFIRMED` | `SALES`, `MANAGER`, `ADMIN` |
| Cancelar | `SALES`, `MANAGER`, `ADMIN` |
| Editar un pedido | `SALES`, `MANAGER`, `ADMIN` |

El `DRIVER` **no** confirma pedidos.

**Transiciones operativas** — abiertas a **cualquier empleado autenticado**:

`PICKED` · `OUT_FOR_DELIVERY` · `DELIVERED` · `OUT_FOR_PICKUP` · `COMPLETED`

En estas, **el rol determina lo que el usuario ve por defecto, no lo que puede hacer.** El conductor abre la app en despachos y el vendedor en pedidos, pero si al vendedor le toca alistar porque bodega no vino, el botón está disponible.

La responsabilidad no se pierde: `order_events` registra quién ejecutó cada transición. **Se rinde cuentas por auditoría, no por prohibición.**

> **Nota de implementación:** no confundir "abierto" con "sin verificar". Las transiciones operativas siguen exigiendo sesión válida y siguen validando que la transición sea legal desde el estado actual y para el método de entrega del pedido (ver 6.2). Lo que se elimina es la restricción **por rol**, no la validación.

### 3.4 Regla de verificación

**Los permisos se verifican siempre en el servidor.** Cada `+page.server.ts` y cada `+server.ts` resuelve el actor y llama a `requireRole(actor, [...])` como primera línea. Esconder botones en el UI no es control de acceso.

La verificación recibe el **actor resuelto**, no `locals` (ver sección 2.8): así el mismo control sirve para una sesión con cookie y para cualquier otro transporte que se agregue después.

---

## 4. Autenticación

### 4.1 Empleados

- **Login con correo electrónico** y contraseña. El correo se normaliza a minúsculas al guardar y al buscar.
- Hash con **PBKDF2-SHA256 vía WebCrypto**. `bcrypt` y `@node-rs/argon2` son bindings nativos de Node y **no funcionan en Workers**.
- Formato de almacenamiento: columnas separadas `password_hash` y `password_salt`, ambas en base64.
- **No existe recuperación de contraseña.** No hay enlace de "olvidé mi contraseña", no hay envío de correos, no hay tabla de tokens. El **administrador restablece la contraseña manualmente** desde el dashboard.
- El empleado **no** está obligado a cambiar la contraseña que le fijó el administrador.

### 4.2 Sesiones

- Tabla `sessions` en **D1**, nunca en Workers KV (KV es de consistencia eventual y un logout podría no surtir efecto).
- El token de sesión son 32 bytes aleatorios. En la tabla se guarda el **SHA-256 del token**, no el token: así una fuga de la base de datos no entrega sesiones activas.
- La sesión dura **30 días** (`expires_at` inicial). Cookie `httpOnly`, `secure`, `sameSite=lax`, `path=/`, con **expiración deslizante** (se renueva si le queda menos de la mitad de vida).
- **No deshabilitar el `checkOrigin` de SvelteKit**: es su protección CSRF y viene activa por defecto.
- El **rate limiting del login** no va en el código: se configura en Cloudflare (WAF / rate limiting de plataforma).
- La sesión se resuelve en `hooks.server.ts` y se expone en `event.locals.user`.
- Al desactivar un usuario se borran todas sus sesiones.

### 4.3 Clientes

**La consulta del cliente no es autenticación.** No crea sesión, no pone cookie, no toca la tabla `sessions`.

El cliente ingresa **teléfono + fecha del evento** en la landing pública y ve el estado de su pedido.

- El teléfono se normaliza (solo dígitos) antes de comparar, tanto al guardar como al consultar.
- **Requiere rate limiting**: la combinación teléfono + fecha es adivinable.
- El resultado se muestra en una URL que usa `orders.public_token` (aleatorio), **nunca el `id` secuencial**. Con IDs consecutivos, cualquiera podría probar `/order/1044` y ver el pedido de otra persona.

---

## 5. Modelo de datos

Trece tablas. Todos los identificadores son `INTEGER PRIMARY KEY AUTOINCREMENT` salvo `sessions` (hash del token) y `holidays` (la fecha es la llave).

**Todas incluyen el bloque de auditoría de la sección 2.6.**

### 5.1 `users`

```sql
id             INTEGER PRIMARY KEY AUTOINCREMENT,
email          TEXT    NOT NULL UNIQUE,      -- minúsculas
full_name      TEXT    NOT NULL,
roles          TEXT    NOT NULL,             -- JSON: ["WAREHOUSE","DRIVER"]
id_number      TEXT    UNIQUE,               -- cédula
attributes     TEXT    NOT NULL DEFAULT '{}', -- JSON
password_hash  TEXT    NOT NULL,
password_salt  TEXT    NOT NULL,
active         INTEGER NOT NULL DEFAULT 1,
created_at     INTEGER NOT NULL,
created_by     TEXT    NOT NULL,
updated_at     INTEGER NOT NULL,
updated_by     TEXT    NOT NULL
```

`roles` se valida con Zod: array no vacío, sin duplicados, valores en `ADMIN | MANAGER | SALES | WAREHOUSE | DRIVER`. **`CLIENT` no es un valor válido**: los clientes no son filas de esta tabla.

Los usuarios **nunca se borran**, se desactivan (`active = 0`), porque firman pedidos y registros de horas.

El primer administrador lo crea el seed con `created_by = 'system@seed'`.

**`attributes`** guarda datos del empleado que no necesitan columna propia:

```jsonc
{
  "monthly_salary": 1750905,
  "position": "conductor",
  "hire_date": "2026-01-13"
}
```

`position` y `hire_date` **aparecen impresos en el comprobante de nómina** (16.8).

El salario vive aquí y no como columna porque **la nómina se liquida empleado por empleado**: se lee de a una fila por vez y nunca se consulta en conjunto. La contrapartida es que la base ya no puede garantizar que sea entero de pesos — **eso pasa a ser responsabilidad de Zod** (la regla de dinero entero de la sección 20).

**`id_number` sí es columna propia**, con `UNIQUE`, para que dos empleados con la misma cédula sean un error detectable. Alimenta el comprobante de nómina (sección 16).

**La bonificación semanal no va en ninguno de los dos**: la digita el gerente en cada liquidación, no es un valor fijo del empleado.

Como esta tabla contiene salarios, **la pantalla de empleados es sensible**. La ven `ADMIN` y `MANAGER`, que son quienes liquidan; nadie más.

### 5.2 `sessions`

```sql
id          TEXT    PRIMARY KEY,   -- SHA-256 del token
user_id     INTEGER NOT NULL REFERENCES users(id),
expires_at  INTEGER NOT NULL,
created_at  INTEGER NOT NULL,
created_by  TEXT    NOT NULL,      -- el propio usuario
updated_at  INTEGER NOT NULL,
updated_by  TEXT    NOT NULL
```

Índice en `user_id`. La expiración deslizante actualiza `updated_at`.

### 5.3 `holidays`

```sql
date        TEXT PRIMARY KEY,   -- YYYY-MM-DD
label       TEXT,
created_at  INTEGER NOT NULL,
created_by  TEXT    NOT NULL,
updated_at  INTEGER NOT NULL,
updated_by  TEXT    NOT NULL
```

Funcionalmente son **días en que no se despacha**: incluyen festivos oficiales, pero también días que la empresa cierra por otra razón. El campo `label` cubre ambos casos.

> **Advertencia:** esta tabla también alimenta el cálculo de recargos de nómina (15.3). En la práctica solo se marcan festivos oficiales, y así debe seguir siendo: si alguien marca aquí un cierre interno de la empresa, la nómina pagaría recargo del 90% por un día que no es festivo legal.

Los festivos colombianos se **pre-cargan en el seed** (son calculables; la Ley Emiliani los corre al lunes siguiente), con `created_by = 'system@seed'`. El seed debe ser **idempotente**: correrlo dos veces no duplica ni pisa lo que alguien agregó a mano. El administrador puede agregar y quitar días desde el dashboard.

### 5.4 `clients`

```sql
id          INTEGER PRIMARY KEY AUTOINCREMENT,
phone       TEXT    NOT NULL UNIQUE,   -- solo dígitos, normalizado
full_name   TEXT    NOT NULL,
email       TEXT,                      -- opcional, para notificaciones
address_1   TEXT,                      -- calle y número
address_2   TEXT,                      -- apto, conjunto, torre, referencias
notes       TEXT,
created_at  INTEGER NOT NULL,
created_by  TEXT    NOT NULL,
updated_at  INTEGER NOT NULL,
updated_by  TEXT    NOT NULL
```

**Un teléfono = un cliente.** La dirección del cliente **no es** la dirección de entrega del pedido: el mismo cliente puede hacer un evento en una finca y otro en un salón. La del cliente solo se usa para autocompletar.

**El email es opcional.** Se pide, pero nunca se exige: muchos pedidos entran por teléfono y el cliente no lo da. Es el canal de notificaciones (sección 18); un cliente sin correo simplemente no recibe notificaciones automáticas.

**La dirección va en dos líneas.** La segunda es para apartamento, nombre del conjunto, torre o referencias — que en Medellín son la diferencia entre encontrar el sitio y no encontrarlo.

### 5.5 `products`

```sql
id              INTEGER PRIMARY KEY AUTOINCREMENT,
name            TEXT    NOT NULL,
category        TEXT    NOT NULL,
variant_group   TEXT,                      -- "Mantel cuadrado 50×50" (nulo si no aplica)
variant_name    TEXT,                      -- "Dorado" (nulo si no aplica)
description     TEXT,
rental_price    INTEGER NOT NULL,          -- por día
total_quantity  INTEGER NOT NULL,
photo_key       TEXT,                      -- llave en R2
active          INTEGER NOT NULL DEFAULT 1,
created_at      INTEGER NOT NULL,
created_by      TEXT    NOT NULL,
updated_at      INTEGER NOT NULL,
updated_by      TEXT    NOT NULL
```

`CHECK (category IN ('CHAIRS_TABLES','LINENS','GLASSWARE','CUTLERY','TABLEWARE','CHAFERS_TRAYS','DECOR'))`

Las categorías son una **lista fija en constantes**. Están tomadas del catálogo real de la empresa y sirven para agrupar y filtrar en la grilla del pedido, que en móvil sería incómoda como lista plana de 60 productos.

**Variantes.** Algunos productos existen en varias presentaciones: un mantel cuadrado de 50×50 puede tener hasta veinte colores. Solo 5 o 6 productos del catálogo tienen variantes.

Se modelan con dos campos en la **misma tabla**, sin tabla aparte y **sin fila padre**:

- `variant_group` — el nombre común, p. ej. "Mantel cuadrado 50×50".
- `variant_name` — la variación, p. ej. "Dorado".

**Cada variante es una fila de producto normal y completa**: tiene su propio `rental_price`, su propio `total_quantity`, su propia foto. Los manteles dorados valen más que los rojos y se cuentan por separado.

Consecuencias, y son la razón del diseño:

- **El inventario se cuenta por variante.** Si el cliente pide 20 manteles verdes, tener 20 azules no sirve. `total_quantity`, disponibilidad, novedades y conteos operan sobre la fila de la variante.
- **En la búsqueda del formulario de pedido las variantes aparecen sueltas**, como productos independientes. Es el objetivo explícito: acelerar la toma de pedidos.
- **No hay filas no vendibles.** Se descartó modelar esto con un `parent_id` justamente por eso: una fila padre "Mantel cuadrado 50×50" no se puede agregar a un pedido, obligaría a filtrarla en la consulta más caliente de la app, y dejaría `rental_price` y `total_quantity` sin sentido.
- **`name` es el nombre completo y autosuficiente** de la fila, listo para mostrar y para congelar en el pedido: "Mantel cuadrado 50×50 — Dorado". No se compone en tiempo de consulta a partir de `variant_group` + `variant_name`; esos dos campos solo agrupan y ordenan.
- **`variant_group` solo agrupa en la pantalla de catálogo**, para ver el mantel con sus veinte colores juntos. No participa en ninguna otra consulta.
- Al crear un producto, `variant_group` **se escoge de una lista de los grupos existentes**, no se digita libre. Con 5 o 6 grupos, es lo único que hace falta para evitar que un error de digitación cree un grupo fantasma.

Sin valor de reposición por ahora. Los productos **nunca se borran**, se desactivan, porque los pedidos históricos guardan su `id`.

### 5.6 `orders`

```sql
id                INTEGER PRIMARY KEY AUTOINCREMENT,  -- es el consecutivo legible
public_token      TEXT    NOT NULL UNIQUE,            -- crypto.randomUUID(), nunca Math.random()
client_id         INTEGER NOT NULL REFERENCES clients(id),
parent_order_id   INTEGER REFERENCES orders(id),      -- pedidos de extensión
status            TEXT    NOT NULL,
has_incident      INTEGER NOT NULL DEFAULT 0,

client_name       TEXT    NOT NULL,                   -- snapshot
client_phone      TEXT    NOT NULL,                   -- snapshot

event_date        TEXT    NOT NULL,
delivery_date     TEXT    NOT NULL,
delivery_time     TEXT,
pickup_date       TEXT    NOT NULL,
pickup_time       TEXT,
rental_days       INTEGER NOT NULL,
delivery_address_1 TEXT   NOT NULL,
delivery_address_2 TEXT,

delivery_method   TEXT    NOT NULL DEFAULT 'COMPANY_DELIVERY',
return_method     TEXT    NOT NULL DEFAULT 'COMPANY_PICKUP',
carrier_name      TEXT,                                -- texto libre
carrier_phone     TEXT,                                -- texto libre

order_items       TEXT    NOT NULL,                   -- JSON
items_total       INTEGER NOT NULL,
discount          INTEGER NOT NULL DEFAULT 0,
transport_cost    INTEGER NOT NULL DEFAULT 0,
order_total       INTEGER NOT NULL,
deposit_amount    INTEGER NOT NULL DEFAULT 0,

notes             TEXT,
delivery_notes    TEXT,                                -- notas del conductor al entregar
pickup_notes      TEXT,                                -- notas del conductor al recoger
created_at        INTEGER NOT NULL,
created_by        TEXT    NOT NULL,
updated_at        INTEGER NOT NULL,
updated_by        TEXT    NOT NULL
```

`CHECK (status IN ('DRAFT','CONFIRMED','PICKED','OUT_FOR_DELIVERY','DELIVERED','OUT_FOR_PICKUP','COMPLETED','CANCELLED'))`

Índices: `delivery_date`, `pickup_date`, `event_date`, `status`, `client_id`.

`CHECK (delivery_method IN ('COMPANY_DELIVERY','CLIENT_PICKUP','EXTERNAL_CARRIER'))`
`CHECK (return_method IN ('COMPANY_PICKUP','CLIENT_RETURN','EXTERNAL_CARRIER'))`

`client_name` y `client_phone` van **copiados** aunque exista `client_id`: si el cliente corrige su nombre el año entrante, el pedido viejo conserva cómo se llamaba entonces.

**Métodos de entrega y retorno.** Son **dos ejes independientes**: el cliente puede recoger en la bodega y la empresa ir por los muebles después, o al revés. No se derivan uno del otro.

- `CLIENT_PICKUP` — el cliente recoge en las instalaciones de la empresa.
- `EXTERNAL_CARRIER` — lo mueve un transportador externo. **No tiene acceso a la aplicación** y no se le diseña ruta.

`carrier_name` y `carrier_phone` son **texto libre**, no una tabla: son unos pocos transportadores y no requieren catálogo. Solo aplican cuando alguno de los dos métodos es `EXTERNAL_CARRIER`.

**El transporte con transportador externo lo cobra la empresa dentro del pedido.** `transport_cost` funciona igual que siempre y el cliente muchas veces ni se entera de que lo entregó un tercero: **el transportador no aparece en nada que vea el cliente.** Lo que la empresa le paga al transportador externo **no se registra** en esta aplicación (ver sección 23).

La dirección de entrega también va **en dos líneas**, igual que la del cliente: la segunda para el nombre de la finca, el salón, la torre o las referencias del sitio del evento.

Cuando `delivery_method = 'CLIENT_PICKUP'`, se llena con la dirección de la empresa por defecto.

**Esquema de `order_items`:**

```jsonc
[
  {
    "product_id": 12,
    "name": "Silla Tiffany",   // snapshot
    "qty": 120,
    "list_price": 2500,        // precio de catálogo al momento del pedido
    "unit_price": 2200,        // lo que realmente se cobró
    "line_total": 792000       // qty × unit_price × rental_days
  }
]
```

Guardar `list_price` y `unit_price` deja ver cuánto se negoció en cada línea sin cálculos posteriores.

### 5.7 `cash_movements`

**Todo el dinero que entra y sale de la empresa, en una sola tabla.** No solo los abonos de pedidos: también la nómina y los pagos a transportadores externos.

```sql
id              INTEGER PRIMARY KEY AUTOINCREMENT,
concept         TEXT    NOT NULL,
payment_method  TEXT    NOT NULL,   -- CASH | TRANSFER | OTHER
amount          INTEGER NOT NULL,   -- positivo entra, negativo sale
movement_date   TEXT    NOT NULL,   -- fecha civil YYYY-MM-DD
order_id        INTEGER REFERENCES orders(id),         -- nulo si no aplica
payroll_run_id  INTEGER REFERENCES payroll_runs(id),   -- nulo si no aplica
payee           TEXT,                                  -- tercero: transportador, proveedor
notes           TEXT,
created_at      INTEGER NOT NULL,
created_by      TEXT    NOT NULL,
updated_at      INTEGER NOT NULL,
updated_by      TEXT    NOT NULL
```

Conceptos: `INSTALLMENT`, `SECURITY_DEPOSIT`, `INSTALLMENT_REFUND`, `DEPOSIT_REFUND`, `PAYROLL`, `CARRIER_PAYMENT`, `OTHER_EXPENSE`.

**Por qué dos llaves opcionales y no un enlace polimórfico.** La alternativa habitual —`subject_type` + `subject_id`— pierde toda integridad referencial en SQLite. Con dos columnas nulas y tipadas se conservan las llaves foráneas reales, y son solo dos porque no hay más cosas a las que enlazar. Un movimiento sin ninguna de las dos es un egreso suelto, identificado por `concept` y `payee`.

**El signo lleva la dirección**, no una columna aparte. Ya funcionaba así para las devoluciones, y extenderlo a los egresos hace que el saldo de caja sea un `SUM` tan simple como el saldo de un pedido.

> **Todos los movimientos son inmutables.** Nunca se editan ni se borran. Un error se corrige registrando un movimiento contrario.
>
> La tabla lleva `updated_at` y `updated_by` por uniformidad de auditoría, pero **en la práctica siempre serán iguales a `created_at` y `created_by`**. La inmutabilidad es una regla de negocio documentada, no una consecuencia del esquema: **no exponer ninguna ruta de edición ni de borrado**.

### 5.8 `order_events`

```sql
id           INTEGER PRIMARY KEY AUTOINCREMENT,
order_id     INTEGER NOT NULL REFERENCES orders(id),
event_type   TEXT    NOT NULL,   -- CREATED | EDITED | STATUS_CHANGED | CANCELLED
                                 -- | PAYMENT_REGISTERED | INCIDENT_REGISTERED
from_status  TEXT,
to_status    TEXT,
note         TEXT,
snapshot     TEXT    NOT NULL,   -- JSON del pedido completo tras el cambio
created_at   INTEGER NOT NULL,
created_by   TEXT    NOT NULL,   -- quién ejecutó la acción
updated_at   INTEGER NOT NULL,
updated_by   TEXT    NOT NULL
```

Tabla **append-only**, con la misma nota que `cash_movements`: las columnas de modificación existen por uniformidad, pero no hay ruta que las cambie. Se guarda snapshot en **todos** los eventos.

**Regla de implementación:** al listar la línea de tiempo de un pedido, **no traer la columna `snapshot`**. Solo se carga al expandir un evento puntual. De lo contrario cada vista del historial arrastra decenas de KB innecesarios.

### 5.9 `incidents`

```sql
id                    INTEGER PRIMARY KEY AUTOINCREMENT,
order_id              INTEGER NOT NULL REFERENCES orders(id),
incident_items        TEXT    NOT NULL,   -- JSON
incident_description  TEXT    NOT NULL,
photo_keys            TEXT,               -- JSON array de llaves en R2
responsible_party     TEXT    NOT NULL DEFAULT 'UNDETERMINED',
                                          -- UNDETERMINED | CLIENT | CARRIER | COMPANY
status                TEXT    NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | REVERSED
reversal_reason       TEXT,
reversed_by           TEXT,               -- email
reversed_at           INTEGER,
created_at            INTEGER NOT NULL,
created_by            TEXT    NOT NULL,
updated_at            INTEGER NOT NULL,
updated_by            TEXT    NOT NULL
```

**Esquema de `incident_items`:**

```jsonc
[
  { "product_id": 12, "name": "Silla Tiffany",     "qty": 4,  "outcome": "LOST" },
  { "product_id": 33, "name": "Mantel blanco 3×3", "qty": 10, "outcome": "RECOVERABLE" }
]
```

**El desenlace se registra por producto, no por novedad.** Una misma devolución puede traer 4 sillas que no volvieron y 10 manteles apenas manchados: son cosas distintas y se anotan en la misma novedad.

| `outcome` | Qué significa | ¿Ajusta inventario? |
|---|---|---|
| `LOST` | Faltante, no volvió | **Sí**, resta |
| `UNRECOVERABLE` | Volvió pero quedó inservible | **Sí**, resta |
| `RECOVERABLE` | Volvió con daño corregible: manchas, un soporte suelto, algo que se limpia o se repara | **No** |

Se permiten **varias novedades por pedido**. Reversar no borra la fila: cambia `status` a `REVERSED`.

**`responsible_party` arranca siempre en `UNDETERMINED`.** Cuando algo llega dañado hay que **investigar de quién fue la culpa** antes de decidir a quién cobrárselo: pudo ser el cliente, el transportador externo, o la propia empresa al cargar. Quien registra la novedad casi nunca lo sabe en el momento.

Consecuencia directa sobre el dinero: **si el responsable no es el cliente, no se le retiene el depósito de garantía.** El sistema no automatiza la decisión — solo deja el dato registrado para que quien maneja la devolución sepa qué hacer.

`reversed_by` se conserva aparte de `updated_by` porque una edición posterior sobrescribiría `updated_by` y se perdería el dato de quién reversó.

### 5.10 `inventory_counts`

```sql
id               INTEGER PRIMARY KEY AUTOINCREMENT,
status           TEXT    NOT NULL,   -- PENDING_APPROVAL | APPROVED | REJECTED | REVERSED
inventory_items  TEXT    NOT NULL,   -- JSON
review_note      TEXT,
reviewed_by      TEXT,               -- email
reviewed_at      INTEGER,
created_at       INTEGER NOT NULL,
created_by       TEXT    NOT NULL,
updated_at       INTEGER NOT NULL,
updated_by       TEXT    NOT NULL
```

**Esquema de `inventory_items`:**

```jsonc
[
  {
    "product_id": 12,
    "name": "Silla Tiffany",
    "system_qty": 500,     // lo que decía el sistema AL MOMENTO DEL CONTEO
    "counted_qty": 492
  }
]
```

`system_qty` es una **foto del momento del conteo**. Si se cuenta el lunes y se aprueba el jueves, la diferencia se calcula contra lo que decía el sistema el lunes, no contra el valor actual. Ese mismo campo es lo que permite reversar una aprobación.

### 5.11 `timesheets`

```sql
id             INTEGER PRIMARY KEY AUTOINCREMENT,
user_id        INTEGER NOT NULL REFERENCES users(id),   -- dato de negocio, no auditoría
work_date      TEXT    NOT NULL,   -- YYYY-MM-DD
morning_in     TEXT,
morning_out    TEXT,
afternoon_in   TEXT,
afternoon_out  TEXT,
created_at     INTEGER NOT NULL,
created_by     TEXT    NOT NULL,
updated_at     INTEGER NOT NULL,
updated_by     TEXT    NOT NULL,
UNIQUE (user_id, work_date)
```

No se guarda geolocalización.

**No hay campos de pago.** Un día está pagado si existe una liquidación con `status = 'PAID'` que cubre esa fecha (ver 15.5 y 16.7). Una sola fuente de verdad.

`morning_in`, `morning_out`, `afternoon_in` y `afternoon_out` bastan porque ningún turno cruza la medianoche y nunca hay tres bloques en un día (15.2).

`user_id` es la **única llave foránea a `users` que no es auditoría**: identifica de quién son las horas, no quién tocó el registro.

### 5.12 `settings`

**Una sola tabla de configuración para todo el sistema.** Clave-valor, con **un solo valor vigente por clave**: no hay vigencias por fecha ni valores históricos.

```sql
key         TEXT PRIMARY KEY,
value       TEXT NOT NULL,
created_at  INTEGER NOT NULL,
created_by  TEXT    NOT NULL,
updated_at  INTEGER NOT NULL,
updated_by  TEXT    NOT NULL
```

`value` es `TEXT` porque la tabla guarda números y también texto —el nombre y la dirección de la empresa para los encabezados de los dos impresos—. **El tipo real de cada clave lo define y valida Zod**, con un esquema por clave; la base solo almacena.

Claves iniciales:

| Clave | Contenido |
|---|---|
| `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_PHONE` | Encabezado de los impresos |
| `ORDERS_SUGGESTED_ADVANCE_PCT` | Solo referencia visual al confirmar (ver 6.4) |
| `PAYROLL_MINIMUM_WAGE` | Pesos mensuales. Valor por defecto al crear un empleado |
| `PAYROLL_TRANSPORT_ALLOWANCE` | Pesos mensuales |
| `PAYROLL_DAYS_PER_MONTH` | 30 |
| `PAYROLL_HOURS_PER_MONTH` | 210 |
| `PAYROLL_ORDINARY_HOURS_PER_DAY` | 7 |
| `PAYROLL_NIGHT_START`, `PAYROLL_NIGHT_END` | `19:00` y `06:00` |
| `PAYROLL_OVERTIME_DAY_FACTOR` | 125 (= 1,25) |
| `PAYROLL_OVERTIME_NIGHT_FACTOR` | 175 |
| `PAYROLL_HOLIDAY_OVERTIME_DAY_FACTOR` | 215 |
| `PAYROLL_HOLIDAY_OVERTIME_NIGHT_FACTOR` | 265 |
| `PAYROLL_NIGHT_SURCHARGE_FACTOR` | 35 |
| `PAYROLL_PENSION_RATE`, `PAYROLL_HEALTH_RATE` | 400 (= 4%) |

Los factores y tasas van en **puntos básicos enteros** para no guardar decimales: 215 significa 2,15.

### 5.12.1 Convención de nombres y agrupación

**Las claves llevan el módulo como prefijo**: `PAYROLL_`, `ORDERS_`, `COMPANY_`, y más adelante `MCP_`, `WORDPRESS_`, `WHATSAPP_`. Con eso la pantalla de configuración agrupa sin necesidad de una columna adicional.

Se evaluó agregar una columna `module` a la tabla y **se descartó**. Las claves son una lista fija y conocida en tiempo de compilación: nadie crea una clave nueva desde la interfaz, porque cada una necesita su esquema de Zod y eso solo se agrega desplegando. Entonces el módulo es metadato de la clave, igual que su etiqueta en español y su unidad — y todo eso vive en el mismo archivo de constantes:

```ts
// src/lib/settings.ts
export const SETTINGS = {
  PAYROLL_MINIMUM_WAGE: {
    module: 'PAYROLL',
    label: 'Salario mínimo mensual',
    unit: 'pesos',
    schema: z.coerce.number().int().positive()
  },
  PAYROLL_NIGHT_START: {
    module: 'PAYROLL',
    label: 'Inicio de jornada nocturna',
    unit: 'hora',
    schema: z.string().regex(/^\d{2}:\d{2}$/)
  }
}
```

Ventajas sobre la columna: no hay migración al agregar un módulo, ninguna fila puede quedar con el módulo equivocado, y en SQLite no hay que recrear la tabla para ampliar un `CHECK`.

> `PAYROLL_NIGHT_START`, `PAYROLL_NIGHT_END` y `PAYROLL_ORDINARY_HOURS_PER_DAY` los **usa** la derivación de horas (15.3), pero **existen para** la nómina. Van agrupados en Nómina, que es donde el gerente los va a buscar.

**Todos los valores de nómina son parámetros y no constantes** porque la ley los mueve: la jornada bajó a 42 horas, el inicio de la jornada nocturna se adelantó de las 9 a las 7 de la noche, y el recargo dominical sube al 100% en julio de 2027. Cada uno de esos cambios debe resolverse editando un campo, no tocando código.

**Solo `ADMIN` y `MANAGER` editan valores** — un error aquí desajusta toda la nómina.

**El gerente ajusta los valores de nómina antes de correr la liquidación.** El sistema no consulta ninguna tabla de vigencias ni conoce la fecha en que cambió el salario mínimo: se liquida con lo que esté puesto en el momento. La semana que cruza el 31 de diciembre no es un caso especial — el gerente pone el valor que corresponda antes de liquidarla.

### 5.13 `payroll_runs`

Una fila por empleado y por semana.

```sql
id                   INTEGER PRIMARY KEY AUTOINCREMENT,
user_id              INTEGER NOT NULL REFERENCES users(id),
status               TEXT    NOT NULL DEFAULT 'DRAFT',   -- DRAFT | PAID
week_number          INTEGER NOT NULL,   -- cuenta propia, reinicia en enero
period_start         TEXT    NOT NULL,   -- lunes
period_end           TEXT    NOT NULL,   -- domingo
payment_date         TEXT    NOT NULL,

employee_name        TEXT    NOT NULL,   -- snapshot
employee_id_number   TEXT    NOT NULL,   -- snapshot de la cédula
employee_position    TEXT,               -- snapshot del cargo
employee_hire_date   TEXT,               -- snapshot
prepared_by          TEXT    NOT NULL,   -- el "Elaboró:" del comprobante

earnings             TEXT    NOT NULL,   -- JSON
deductions           TEXT    NOT NULL,   -- JSON
settings_snapshot    TEXT    NOT NULL,   -- JSON

total_earnings       INTEGER NOT NULL,
total_deductions     INTEGER NOT NULL,
net_pay              INTEGER NOT NULL,

created_at           INTEGER NOT NULL,
created_by           TEXT    NOT NULL,
updated_at           INTEGER NOT NULL,
updated_by           TEXT    NOT NULL,
UNIQUE (user_id, period_start)
```

**Esquema de `earnings`:**

```jsonc
[
  { "concept": "DAYS_WORKED",  "qty": 6, "amount": 350181 },
  { "concept": "SUNDAY_REST",  "qty": 1, "amount": 58364 },
  { "concept": "TRANSPORT_ALLOWANCE", "qty": 6, "amount": 49819 }
]
```

Conceptos: `DAYS_WORKED`, `SUNDAY_REST`, `HOLIDAY_OVERTIME_DAY`, `HOLIDAY_OVERTIME_NIGHT`, `OVERTIME_DAY`, `OVERTIME_NIGHT`, `NIGHT_SURCHARGE`, `TRANSPORT_ALLOWANCE`, `NON_SALARY_BONUS`.

**Esquema de `deductions`:**

```jsonc
[
  { "concept": "PENSION", "amount": 18335 },
  { "concept": "HEALTH",  "amount": 18335 }
]
```

Conceptos: `PENSION`, `HEALTH`, `LOANS`, `OTHER`. Las filas `LOANS` y `OTHER` llevan además `description`, obligatoria en `OTHER`.

**`status`** solo tiene dos valores. Nace en `DRAFT` y pasa a `PAID` cuando el gerente registra el pago, momento en que **se congela** (16.7).

**`settings_snapshot`** guarda los valores de `settings` con los que se calculó. Es lo que permite que una nómina de hace dos meses siga mostrando lo que se usó, aunque el gerente haya cambiado el parámetro después. Mismo principio que `list_price` en los pedidos.

`employee_name` y `employee_id_number` también van copiados, por la misma razón.

---

## 6. Ciclo de vida del pedido

```
DRAFT
   │  (el vendedor confirma — sin condición de monto)
   ▼
CONFIRMED ──► PICKED ──► OUT_FOR_DELIVERY ──► DELIVERED
                                                  │
                                                  ▼
                                          OUT_FOR_PICKUP
                                                  │
                                                  ▼
                                            COMPLETED

Desde DRAFT, CONFIRMED, PICKED y OUT_FOR_DELIVERY ──► CANCELLED
```

### 6.1 Quién ejecuta cada transición

Solo las **comerciales** están restringidas por rol (ver 3.3):

| Transición | Quién |
|---|---|
| `DRAFT` → `CONFIRMED` | `SALES`, `MANAGER`, `ADMIN` |
| → `CANCELLED` | `SALES`, `MANAGER`, `ADMIN` |

Las **operativas** las puede ejecutar cualquier empleado. La columna "por defecto" indica quién las hace normalmente y define en qué pantalla aparece el botón, no quién tiene permiso:

| Transición | Por defecto |
|---|---|
| `CONFIRMED` → `PICKED` | `WAREHOUSE` |
| `PICKED` → `OUT_FOR_DELIVERY` | `DRIVER` |
| `OUT_FOR_DELIVERY` → `DELIVERED` | `DRIVER` |
| `DELIVERED` → `OUT_FOR_PICKUP` | `DRIVER` |
| `OUT_FOR_PICKUP` → `COMPLETED` | `WAREHOUSE` |

Normalmente bodega marca `COMPLETED`, así que **es bodega quien suele detectar y registrar las novedades** al contar lo que volvió.

### 6.2 El ciclo se ramifica según el método de entrega

No todos los pedidos pasan por los mismos estados. **La transición válida depende de `delivery_method` y `return_method`**, no solo del estado actual.

**Salida:**

| `delivery_method` | Ruta | Quién marca `DELIVERED` |
|---|---|---|
| `COMPANY_DELIVERY` | `PICKED` → `OUT_FOR_DELIVERY` → `DELIVERED` | `DRIVER` |
| `CLIENT_PICKUP` | `PICKED` → `DELIVERED` | `WAREHOUSE`, cuando el cliente se lo lleva |
| `EXTERNAL_CARRIER` | `PICKED` → `OUT_FOR_DELIVERY` → `DELIVERED` | `SALES` o `MANAGER` |

Notas:

- Con `CLIENT_PICKUP` **se salta `OUT_FOR_DELIVERY`**: nadie sale a entregar nada.
- Con `EXTERNAL_CARRIER`, `OUT_FOR_DELIVERY` lo marca bodega al entregarle la carga al transportador. Como el transportador externo no usa la app, `DELIVERED` lo marca después ventas o gerencia al confirmar que llegó.

**Retorno:** análogo. Con `CLIENT_RETURN` se salta `OUT_FOR_PICKUP` y el pedido pasa de `DELIVERED` directo a `COMPLETED` cuando el cliente trae los muebles a la bodega.

> **Implementación:** la validación de transiciones es una sola función que recibe estado actual, estado destino y los dos métodos del pedido. No dispersar esta lógica por las pantallas.

### 6.3 "Con novedad" no es un estado

Es la bandera `orders.has_incident`. Un pedido con daños queda `COMPLETED` **y** `has_incident = 1`: el pedido sí terminó, solo que faltó mercancía.

La bandera se calcula como "existe al menos una novedad con `status = 'ACTIVE'`". Si un administrador reversa todas las novedades de un pedido, vuelve a 0.

En la búsqueda del dashboard es un **filtro independiente** ("solo pedidos con novedad"), no un valor más de la lista de estados.

### 6.4 Confirmación

**No se exige anticipo.** El vendedor confirma cuando quiera, incluso con $0 registrado. El porcentaje sugerido es una constante en configuración que solo se **muestra en pantalla como referencia** ("sugerido: $450.000"). No implementar ninguna validación sobre él.

### 6.5 Cancelación

- Puede cancelar: `SALES`, `MANAGER`, `ADMIN`.
- Desde: `DRAFT`, `CONFIRMED`, `PICKED`, `OUT_FOR_DELIVERY`. Después de `DELIVERED` ya no, porque la mercancía está donde el cliente.
- **La cancelación libera el inventario sola.** Como la consulta de disponibilidad solo suma pedidos en estados activos, pasar a `CANCELLED` los saca del cálculo automáticamente. **No programar ningún proceso de liberación de inventario.**
- Los abonos ya registrados **se le devuelven al cliente**, pero la devolución se registra **manualmente** cuando la plata se entrega físicamente (ver sección 8).

### 6.6 Edición de pedidos

Un pedido se puede modificar desde `DRAFT` **hasta `DELIVERED`** inclusive. Después es de solo lectura.

- Pueden editar: `SALES`, `MANAGER`, `ADMIN` (los mismos que confirman).
- **Toda edición posterior a `CONFIRMED` escribe una fila en `order_events`** con snapshot completo.
- Cambiar cantidades **no requiere sincronizar nada**: la disponibilidad es una consulta en vivo sobre los ítems actuales.
- **Si el pedido ya pasó de `CONFIRMED`, bodega ya alistó la mercancía.** El pedido debe aparecer **resaltado en la lista de bodega** como "modificado después de separar", comparando `updated_at` contra la fecha del evento `PICKED` en `order_events`. Sin eso, ventas puede agregar 40 sillas desde la oficina y el camión sale incompleto.

### 6.7 Pedidos de extensión

Si un cliente quiere quedarse más días con parte de los productos, **se genera un pedido nuevo** solo con esos productos, no se modifica el original.

- El pedido hijo lleva `parent_order_id`.
- **Nace directamente en estado `DELIVERED`**, saltándose `PICKED` y `OUT_FOR_DELIVERY`: los productos ya están donde el cliente, no hay que despacharlos. De lo contrario aparecería en la lista de bodega como una entrega pendiente que nadie va a hacer.
- Tiene **su propia fecha de recogida**.
- **Cuando un pedido tiene un hijo de extensión, su recogida no aparece en la lista de bodega.** La del hijo sí. Sin esta regla el despachador vería dos recogidas de los mismos muebles.
- El inventario cuadra solo: el padre bloquea del día 1 al 4, el hijo del 4 al 7, cobertura continua sin doble conteo.

---

## 7. Precios y totales

### 7.1 Precio por día, días facturados independientes

El precio es **por día**. `rental_days` lo **decide el vendedor** y se guarda en el pedido.

**`rental_days` NO se deriva de las fechas.** Un pedido puede facturarse como 3 días de alquiler aunque los productos se recojan al cuarto o quinto día, porque el evento fue lejos. Ambos números son independientes:

- **`rental_days`** → determina el **precio**.
- **`delivery_date` → `pickup_date`** → determina el **bloqueo de inventario** y lo que ve bodega.

La diferencia entre ambos es normal y esperada, **no es un error a corregir**.

`rental_days` es uno solo por pedido, no varía por línea.

### 7.2 Fórmula

```
line_total   = qty × unit_price × rental_days
items_total  = Σ line_total
order_total  = items_total − discount + transport_cost
```

### 7.3 Descuentos

Existen **dos niveles** y conviven:

1. **Precio unitario editable por línea** — el vendedor ajusta el precio de un producto puntual (alta demanda, alto valor de reposición). Queda como `unit_price`, con `list_price` guardando el de catálogo.
2. **Descuento sobre el pedido** — capturado como **monto en pesos**, no porcentaje. Aplica **solo sobre `items_total`, nunca sobre el transporte**. Validación: `discount ≤ items_total`.

En pantalla se puede mostrar el porcentaje equivalente calculado, pero no se guarda.

En pedidos grandes el vendedor negocia jugando con `rental_days` y `transport_cost`. Ambos son campos libres.

### 7.4 Sin IVA

**No se maneja IVA. Todos los precios ya incluyen todos los impuestos.**

No hay `subtotal`, `tax_base`, `tax_amount`, NIT del cliente ni consecutivo de factura. No agregar campos de impuestos.

---

## 8. Movimientos de caja

### 8.1 Modelo

Todo el dinero de la empresa vive en `cash_movements` (5.7): abonos de pedidos, devoluciones, nómina y pagos a terceros. Registro **manual**, sin pasarela de pago.

| Concepto | Etiqueta | Signo | Enlace |
|---|---|---|---|
| `INSTALLMENT` | Abono | + | `order_id` |
| `SECURITY_DEPOSIT` | Depósito de garantía | + | `order_id` |
| `INSTALLMENT_REFUND` | Devolución de abono | − | `order_id` |
| `DEPOSIT_REFUND` | Devolución de depósito | − | `order_id` |
| `PAYROLL` | Pago de nómina | − | `payroll_run_id` |
| `CARRIER_PAYMENT` | Pago a transportador | − | `order_id` + `payee` |
| `OTHER_EXPENSE` | Otro egreso | − | `payee` |

El movimiento `PAYROLL` lo graba el sistema **al congelar una liquidación** (16.7), no se registra a mano. El pago mensual de aportes a suaporte.com.co se registra como `OTHER_EXPENSE` con `payee`, ya que la app no calcula el aporte patronal.

Métodos: `CASH`, `TRANSFER`, `OTHER`.

Pueden registrar movimientos de pedido: **`SALES`, `MANAGER`, `ADMIN`**. Los egresos —nómina, transportadores, otros— solo **`MANAGER` y `ADMIN`**.

**El conductor no registra pagos.** Aunque cobre en la calle, **el movimiento se registra cuando la plata entra a la oficina**, no cuando él la recibe. Lo que sí deja el conductor es una nota en el pedido (12.1).

### 8.2 Saldos

```
balance_due   = order_total − SUM(amount WHERE order_id = ?
                                    AND concept IN (INSTALLMENT, INSTALLMENT_REFUND))
deposit_held  = SUM(amount WHERE order_id = ?
                              AND concept IN (SECURITY_DEPOSIT, DEPOSIT_REFUND))
net_period    = SUM(amount WHERE movement_date BETWEEN ? AND ?)
```

La última línea es el punto de generalizar la tabla: **el libro de caja es una sola consulta**, sin unir nada.

> Ojo con el nombre: `net_period` es el **neto del periodo**, no un saldo de caja. Mezcla efectivo con transferencias, así que no dice cuánta plata física hay. Eso es correcto para este caso —casi todos los pagos son por transferencia y no se hace cuadre de efectivo—, pero no lo llames saldo de caja.

Ojo con el pago al transportador externo: **se registra como egreso pero no se descuenta del total del pedido.** El cliente paga el transporte a la empresa (7.3) y la empresa le paga al tercero; son dos movimientos independientes que solo comparten el `order_id`.

Un pedido `CANCELLED` con abonos netos mayores a cero es un pedido al que **le deben plata al cliente**. Sirve directamente como filtro del dashboard sin agregar columnas.

### 8.3 Depósito de garantía

Es dinero **retenido, no ingreso**. `deposit_amount` en el pedido **no suma a `order_total`**.

Se devuelve al cliente si al recoger los productos están completos y sin daños.

La decisión de retenerlo depende de **dos cosas juntas**: quién fue el responsable y qué tan grave fue el desenlace. No se retiene si el responsable fue el transportador o la propia empresa, ni tampoco por una novedad enteramente `RECOVERABLE` —unas manchas que salen al lavar no justifican quedarse con la garantía—. **El sistema no automatiza esa decisión**: registra el responsable y el desenlace, y quien maneja la devolución decide con esos datos a la vista (ver 5.9 y 13.1).

**La retención no requiere nada:** simplemente nunca se registra el `DEPOSIT_REFUND`. No hay campo de "retenido" ni estado especial. Y como el monto de la devolución lo escribe quien la registra, se puede devolver **parcialmente** si el daño fue menor. La flexibilidad sale gratis.

### 8.4 Inmutabilidad y advertencia

**Ningún movimiento de caja se edita ni se borra.** Un error se corrige con un movimiento contrario.

Por eso, **antes de guardar el sistema muestra un popup de confirmación** con el monto, el concepto y el método, advirtiendo que no se podrá corregir.

El saldo pendiente **no bloquea** el despacho ni la entrega.

### 8.5 Libro de caja

Pantalla de **registro auditable**: sirve para buscar y rastrear movimientos, no para cuadrar efectivo al cierre del día.

**Solo `MANAGER` y `ADMIN`.**

**Filtros:** rango de fechas (por defecto el mes actual), concepto, método, entradas o salidas, pedido o empleado, rango de monto, y texto libre sobre `payee` y `notes`.

**Columnas:** fecha, concepto, monto con signo, método, enlace (pedido #1043, semana 29, o el nombre del tercero) y quién lo registró.

**Tres totales del periodo filtrado:** entró, salió y neto.

**Acción de corrección.** Como los movimientos son inmutables, la pantalla ofrece **"registrar movimiento contrario"**, que abre el formulario con el inverso precargado. Sin eso la inmutabilidad se siente como un obstáculo en vez de una garantía.

Deliberadamente **no hay saldo inicial de caja, ni cuadre de efectivo, ni control de quién tiene físicamente el dinero**. Casi todos los pagos son por transferencia y el movimiento se registra cuando la plata llega a la oficina, así que nada de eso hace falta.

### 8.6 Recibo de caja

**Tercer formato impreso** de la aplicación, junto al del pedido (10.2) y el de nómina (16.8). Media carta vertical, con CSS de impresión.

Se imprime **desde el detalle del movimiento**.

Una misma plantilla sirve para los dos sentidos, cambiando el título: **"Recibo de caja"** para las entradas y **"Comprobante de egreso"** para las salidas.

Contenido:

1. Datos de la empresa, desde `settings`.
2. Número consecutivo — sirve el `id` del movimiento.
3. Fecha.
4. "Recibido de" o "Pagado a".
5. Concepto y monto **en números y en letras**, como se acostumbra en Colombia.
6. Método de pago y pedido relacionado, si aplica.
7. Línea de firma.

> Como el movimiento se registra cuando la plata llega a la oficina, **un cliente que paga en efectivo en el sitio no recibe recibo en el momento**. Con casi todo en transferencia el cliente tiene su soporte bancario, así que se acepta; queda anotado para que sea una decisión y no una sorpresa.

---

## 9. Inventario y disponibilidad

### 9.1 Cálculo

```
available(product, date) =
    products.total_quantity
  − SUM(cantidad reservada en pedidos con estado
        CONFIRMED, PICKED, OUT_FOR_DELIVERY, DELIVERED, OUT_FOR_PICKUP
        cuyo rango [delivery_date, pickup_date] incluye la fecha)
```

El bloqueo cubre **todo el rango entre entrega y recogida**, no solo la fecha del evento. Los pedidos en `DRAFT` no descuentan, pero el formulario sí muestra disponibilidad como referencia.

Como los ítems están en JSON, la consulta usa `json_each`:

```sql
SELECT SUM(CAST(json_extract(item.value, '$.qty') AS INTEGER))
FROM orders, json_each(orders.order_items) AS item
WHERE orders.status IN ('CONFIRMED','PICKED','OUT_FOR_DELIVERY',
                        'DELIVERED','OUT_FOR_PICKUP')
  AND orders.delivery_date <= ?1 AND orders.pickup_date >= ?1
  AND json_extract(item.value, '$.product_id') = ?2
```

Es un escaneo sin índice sobre `product_id`, pero con 5–10 pedidos diarios el costo es de milisegundos.

### 9.2 La disponibilidad es informativa, nunca bloquea

**Regla central:** la disponibilidad **advierte, no restringe**, en ningún rol y en ninguna pantalla.

- Si la cantidad pedida supera lo disponible, se muestra advertencia y **se permite agregar el producto igual**.
- Al confirmar se re-consulta la disponibilidad y, si hay sobrecupo, se advierte **sin bloquear**.
- **`available` puede ser negativo y es un estado válido.** No usar `Math.max(0, ...)` ni ningún guard.
- No hay transacción atómica, no hay reserva, no hay bloqueo. Es solo una consulta.

### 9.3 Días festivos

Si `delivery_date` **o** `pickup_date` caen en un día marcado en `holidays`, el formulario muestra un banner de advertencia. **No se advierte sobre `event_date`**: lo que importa es cuándo sale y entra el camión.

La advertencia no bloquea.

---

## 10. Recepción de pedidos (`SALES` / `MANAGER` / `ADMIN`)

**Una sola pantalla, no un wizard por pasos.** Los pedidos llegan por WhatsApp, correo o llamada, y el vendedor los captura mientras habla, saltando entre secciones.

Contenido de la vista:

1. **Teléfono del cliente + fecha del evento.** Si el teléfono ya existe, autocompleta nombre y dirección.
2. **Fechas**: `event_date`, `delivery_date` + hora, `pickup_date` + hora. Advertencia de festivo sobre entrega y recogida, y **advertencia de choque de horario** si otro pedido ya tiene la misma hora de entrega o de recogida ese día. Como todas las advertencias de esta aplicación, **avisa y deja guardar**.
3. **Días de alquiler** (`rental_days`), editable por el vendedor.
4. **Grilla de productos estilo factura**: producto, cantidad, precio de lista, precio a cobrar (editable), total de línea. Disponibilidad en tiempo real para el rango, con advertencia si se excede.
5. **Datos del cliente**: nombres y apellidos, dirección de entrega.
   - **Método de entrega y método de retorno**, seleccionables por separado. Si alguno es `EXTERNAL_CARRIER`, aparecen los campos de nombre y teléfono del transportador. Si la entrega es `CLIENT_PICKUP`, la dirección se llena con la de la empresa.
6. **Totales**: subtotal de ítems, descuento en pesos, costo de transporte, total.
7. **Depósito de garantía**.
8. **Registro de abonos** (con el popup de confirmación de la sección 8.4).

### 10.1 Qué fecha usa cada pantalla

| Pantalla / función | Fecha |
|---|---|
| Consulta pública del cliente | `event_date` |
| Búsqueda en el dashboard | `event_date` (exacta o rango) |
| Lista de despacho de bodega | `delivery_date` |
| Lista de recogidas | `pickup_date` |
| Cálculo de disponibilidad | rango `delivery_date` → `pickup_date` |
| Cálculo del precio | `rental_days` (ninguna fecha) |

### 10.2 Impresión del pedido

Un solo formato, usado tanto por ventas como por bodega y conductor.

- **Tamaño: media carta vertical**, 5.5 × 8.5 pulgadas.
- Se implementa con una hoja de estilos de impresión y `@page { size: 5.5in 8.5in }`. **No se requiere librería de PDF**: basta el diálogo de impresión del navegador.
- **Lleva precios.** Ver la nota de la sección 12 sobre la regla de valores monetarios.

**Contenido:**

1. Nombre de la empresa y número de pedido.
2. Cliente: nombre y teléfono.
3. Dirección de entrega, o la indicación de que **recoge el cliente**.
4. Fecha del evento, fecha y hora de entrega, fecha y hora de recogida, días de alquiler.
5. Transportador externo (nombre y teléfono) cuando aplique.
6. Ítems: cantidad, producto, precio unitario, total de línea.
7. Totales: subtotal, descuento, transporte, total, depósito, abonado y saldo.
8. **Dos líneas de firma**: una para la entrega y otra para la devolución, cada una con nombre, cédula y fecha. En un negocio de alquiler esta es la parte más valiosa del papel — es la prueba de que se entregó y de que volvió.

**Desbordamiento.** Un pedido de 30 líneas no cabe en media hoja. Continúa en una **segunda media hoja**, repitiendo el encabezado con el número de pedido y numerando las páginas ("1 de 2"). Los totales y las firmas van siempre en la última.

---

## 11. Dashboard

| Sección | Acceso |
|---|---|
| Empleados — crear/editar/desactivar, restablecer contraseña | **Solo `ADMIN`** |
| Empleados — ver lista | `ADMIN`, `MANAGER` |
| Días festivos — crear/editar | **Solo `ADMIN`** |
| Días festivos — ver | `ADMIN`, `MANAGER` |
| Productos (catálogo, cantidad, foto) | `ADMIN`, `MANAGER` |
| Historial de novedades + reversar | `ADMIN`, `MANAGER` |
| Conteos físicos — realizar | `ADMIN`, `MANAGER`, `WAREHOUSE`, `DRIVER` |
| Conteos físicos — aprobar | `ADMIN`, `MANAGER` |
| Registro de horas — ver todos y marcar pagado | `ADMIN`, `MANAGER` |
| Búsqueda de pedidos | `ADMIN`, `MANAGER`, `SALES` |

### 11.1 Búsqueda de pedidos

Filtros combinables:

- Teléfono del cliente
- Nombre del cliente
- Fecha del evento (exacta o rango)
- Estado del pedido
- Rango de monto (`order_total`)
- **Solo pedidos con novedad** (filtro independiente, `has_incident = 1`)

---

## 12. Despachos y recogidas (`WAREHOUSE` / `DRIVER`)

**Las listas se dividen según el método de entrega**, porque no todos los pedidos requieren que alguien salga a la calle:

| Lista | Contiene | Para quién |
|---|---|---|
| **Ruta del día** | Solo `COMPANY_DELIVERY` / `COMPANY_PICKUP` | `DRIVER` |
| **Alistar hoy** | **Todos**, sin importar el método | `WAREHOUSE` |
| **Entregas sin ruta** | `CLIENT_PICKUP` y `EXTERNAL_CARRIER` | `WAREHOUSE`, `SALES` |

La distinción clave: un pedido que **recoge el cliente no va en la ruta del conductor**, pero **sí tiene que estar en la lista de alistamiento de bodega** — alguien tiene que dejarlo listo para cuando el cliente llegue. Lo mismo con los de transportador externo.

Ambas listas se ordenan por `delivery_time` y `pickup_time` respectivamente.

- En los pedidos con transportador externo se muestran `carrier_name` y `carrier_phone`.
- Los pedidos modificados después de haber sido separados aparecen **resaltados** (ver 6.6).
- Los pedidos con hijo de extensión **no muestran su recogida** (ver 6.7).
- El día se calcula siempre con `getTodaysDate(COMPANY_TIMEZONE)`.

### 12.1 Notas del conductor

Al marcar la entrega o la recogida, el conductor puede dejar una **nota libre** en `delivery_notes` o `pickup_notes`.

Es donde queda constancia de cosas que el modelo no captura: *"se recibió $20.000"*, *"la persona que recibió fue el encargado de seguridad"*, *"faltaba un mantel al cargar"*.

Cobra importancia porque **el conductor ya no registra pagos** (8.1): si cobra en efectivo en la calle, la nota es el rastro hasta que alguien registre el movimiento en la oficina. También resuelve algo que faltaba: hasta ahora no había dónde anotar **quién recibió la mercancía**.

> **Nota sobre los valores monetarios.** Este documento decía que el detalle operativo oculta los precios a bodega y conductor. Esa regla **queda derogada**: el impreso del pedido (10.2) los lleva, y esconderlos en pantalla mientras van en el papel que el conductor carga en la mano no protege nada. **Bodega y conductor ven los valores igual que los demás.**

### 12.2 Modo sin conexión

El conductor sale a zonas sin señal. La app debe permitirle **consultar** los despachos del día sin Internet.

**La aplicación completa es una PWA, desde la fase 0.** Guardar datos en `localStorage` no basta: sin red el navegador no puede cargar ni el HTML ni el JavaScript, así que no hay app que muestre esos datos. Hace falta un **service worker** que cachee el shell. SvelteKit lo soporta de fábrica vía `src/service-worker.js`.

El trabajo se reparte así:

- **Fase 0** — manifiesto, iconos, service worker, instalable en el teléfono, el shell carga sin red. Es infraestructura y retrofitearla después es doloroso.
- **Fase de operación** — el guardado de los datos del despacho del día en `localStorage`, que es una función del módulo, no de la infraestructura.

**Alcance: solo lectura.**

- Al cargar la pantalla de despachos **con** conexión, se guarda en `localStorage` la lista del día y el detalle operativo de cada pedido.
- **Sin** conexión, se muestra lo guardado con un aviso visible de la hora en que se capturó ("datos de las 7:14 a.m.").
- **Todas las acciones de escritura se deshabilitan sin conexión**, con una explicación clara. **No hay cola de sincronización, ni resolución de conflictos, ni un bucle verificando si volvió la señal.**
- El caché se guarda **con la fecha a la que corresponde**. Si la fecha guardada no es la de hoy, no se muestra: se indica que no hay datos descargados para el día. Datos de ayer son peores que ningún dato.
- **Decisión consciente:** desde que se derogó la regla de ocultar valores monetarios, el caché en el teléfono del conductor **sí contiene los precios** de los pedidos del día. Se acepta para un equipo de 5 personas; no agregar cifrado ni ofuscación.

**Esto no es un problema crítico y así se decidió.** El pedido se queda en `OUT_FOR_DELIVERY` mientras el conductor está en la calle, y él marca `DELIVERED` al volver a la oficina. Como consecuencia el sistema registra la hora en que lo marcó, no la hora real de la entrega. La alternativa —encolar acciones con su hora real y sincronizarlas— es varias veces más trabajo, porque obliga a resolver qué pasa si el pedido cambió mientras estaba desconectado.

---

## 13. Novedades y devoluciones con daño

Al recibir la mercancía, si hay daño o faltante, **bodega** registra la novedad:

1. Producto(s) y cantidad afectada.
2. **Desenlace por producto**: `LOST`, `UNRECOVERABLE` o `RECOVERABLE` (ver 5.9).
3. **Foto(s)** subidas a R2 y descripción del daño.
4. **Responsable** — arranca en `UNDETERMINED`. Se actualiza después de investigar.
5. El sistema ajusta `products.total_quantity` **solo por los productos marcados `LOST` o `UNRECOVERABLE`**. Los `RECOVERABLE` no tocan el inventario.
6. Se enciende `orders.has_incident = 1` en cualquier caso.
7. Queda en el historial, visible y **reversable** por `ADMIN` o `MANAGER`.

### 13.1 Por qué las recuperables no ajustan inventario

Una buena parte de las novedades son corregibles: un mantel con manchas menores se lava, una silla a la que se le soltó un soporte se repara. **El producto sigue existiendo y sigue siendo alquilable**, así que descontarlo del inventario sería falso.

Pero tampoco se sabe en el momento si la reparación va a funcionar. Por eso **no se implementa ninguna acción de "reparado"**: nadie tiene que volver a la novedad a cerrarla. Si el mantel se recuperó, el inventario ya era correcto y no hay nada que hacer; si no se recuperó, lo detecta el **conteo físico parcial** (sección 14), que es precisamente el mecanismo que existe para eso.

Esta es la razón de ser de los conteos parciales, y explica por qué se hacen sobre los productos que han presentado novedades y no sobre todo el catálogo.

### 13.2 Registro y advertencia

Se permiten **múltiples novedades por pedido**.

Antes de guardar se muestra un **popup de confirmación**. Si la novedad incluye productos `LOST` o `UNRECOVERABLE`, advierte que **ajusta el inventario**; si son todos `RECOVERABLE`, el texto lo dice explícitamente para que quien registra entienda por qué el inventario no cambió. (En ambos casos distinto al de los pagos: las novedades **sí** son reversables.)

### 13.3 Regla de reversión

**No se puede reversar una novedad anterior al último conteo físico aprobado** — pero solo aplica a las novedades que **sí ajustaron inventario** (las que tienen productos `LOST` o `UNRECOVERABLE`).

Razón: la aprobación de un conteo fija `total_quantity` de forma absoluta. Reversar una novedad previa le sumaría una cantidad a un número que ya no tiene relación con ella, y el inventario quedaría mal sin que nadie lo note.

Una novedad **enteramente `RECOVERABLE` se puede reversar en cualquier momento**, porque nunca tocó el inventario: reversarla solo anula el registro.

---

## 14. Conteo físico de inventario

El conteo es **parcial**: no se cuenta todo el catálogo.

**Se hace con frecuencia**, no en un calendario fijo. La cadencia la marcan las novedades: se cuenta cuando se han acumulado suficientes productos por verificar. No modelar esto como un evento programado ni semestral.

Una consecuencia a tener presente: **cada conteo aprobado cierra la ventana de reversión** de las novedades anteriores (ver 13.3). Contando seguido, esa ventana es de días, no de meses. Es correcto —así funciona la regla de "siempre se reversa el último movimiento"— pero significa que un error hay que corregirlo pronto.

**Su propósito principal es verificar los productos que tuvieron novedades `RECOVERABLE`** (ver 13.1). Cuando un mantel se manchó o una silla perdió un soporte, el inventario no se ajustó porque el producto seguía existiendo. El conteo es el momento en que se comprueba si la reparación funcionó o si el producto realmente se perdió.

### 14.1 Qué contar

La pantalla de conteo debe ofrecer una lista sugerida: **los productos con novedades `RECOVERABLE` activas desde el último conteo aprobado**. No es obligatoria —se puede contar cualquier producto— pero es el punto de partida natural y evita que alguien tenga que llevar la cuenta aparte.

- **Quién puede realizarlo:** `WAREHOUSE`, `DRIVER`, `MANAGER`, `ADMIN`.
- **Qué se registra:** por cada producto contado, el total actual. No se pide motivo ni nota por diferencia.
- **No ajusta el inventario automáticamente.** Queda en `PENDING_APPROVAL`.
- **Puede haber varios conteos pendientes de aprobación al mismo tiempo.** Con conteos frecuentes, exigir que uno se apruebe antes de iniciar el siguiente bloquearía a bodega mientras espera al gerente.
- **Quién aprueba:** `ADMIN` o `MANAGER`. Si es uno de ellos quien realiza el conteo, puede **contar y aprobar en el mismo paso**, sin dejarlo pendiente.

### 14.2 Aprobación

Al **aprobar**: `products.total_quantity = counted_qty` para cada producto con diferencia. Con popup de confirmación.

Al **rechazar**: no se aplica ningún cambio (útil si se sospecha un error de conteo y se pide repetirlo).

**Conteos que se solapan.** Como puede haber varios pendientes, dos de ellos podrían incluir el mismo producto con cantidades distintas. La regla es simple: **la aprobación es absoluta y gana la última**, porque `counted_qty` refleja lo que alguien contó físicamente.

Al aprobar un conteo que comparte productos con otro pendiente, el sistema **advierte y muestra cuáles**, pero no bloquea — coherente con el resto de la aplicación. Quien aprueba decide, viendo la fecha de cada conteo, cuál refleja mejor la realidad.

Nota sobre `system_qty`: en un conteo aún pendiente, ese valor puede haber quedado desactualizado si se aprobó otro conteo o se registró una novedad entretanto. La diferencia que se muestra al revisar debe recalcularse contra el `total_quantity` **actual**, y `system_qty` se conserva solo como registro histórico de lo que decía el sistema cuando se contó.

### 14.3 Reversión

La aprobación **es reversible**. Reversar restaura el `system_qty` guardado en el JSON del conteo.

**No se puede reversar la aprobación de un conteo si después hubo novedades que ajustaron inventario o se aprobó otro conteo.** Lo que cuenta es el orden de **aprobación**, no el de creación: un conteo hecho el lunes pero aprobado el viernes es posterior a uno hecho el martes y aprobado el miércoles.

Que haya varios conteos **pendientes** no afecta esta regla, porque un conteo pendiente no ha tocado el inventario y por lo tanto no es un movimiento.

> Regla general de inventario: **siempre se reversa el último movimiento, nunca uno de en medio.** Aplica igual a novedades y a conteos, y se implementa en una sola función.

---

## 15. Registro de horas

Todos los empleados registran sus horas diarias: **entrada mañana, salida mañana, entrada tarde, salida tarde**. Solo la hora, **sin geolocalización**.

Este módulo **alimenta la liquidación de nómina** (sección 16): de estas marcas se derivan automáticamente las horas extras y el recargo nocturno, que hoy el gerente cuenta a mano leyendo un papel los sábados.

### 15.1 Dos formas de registrar

Ambas conviven, porque en la práctica los empleados olvidan registrar:

- **El empleado registra lo suyo** — es el camino normal.
- **`ADMIN` y `MANAGER` registran por él** — al entrar al módulo ven un **desplegable para seleccionar el empleado**, y capturan o corrigen sus marcas. Replica el proceso actual, en el que alguien transcribe lo que está en papel.

### 15.2 Límites del modelo de marcas

Dos restricciones operativas de la empresa hacen que cuatro marcas al día sean suficientes:

- **Ningún turno cruza la medianoche.** Por prevención legal no se permite entrar a las 2 p.m. y salir a las 3 a.m. Si hay que recoger de madrugada, esas horas se registran como parte del **día siguiente**.
- **Nunca se trabajan tres bloques en un día.** Máximo mañana y tarde.

Sin estas dos reglas habría que rediseñar la tabla con marcas de tiempo completas. Con ellas, `TEXT` en formato `HH:MM` sobre una sola fecha funciona.

> Consecuencia a tener presente: si la recogida del sábado en la noche se anota el domingo, esas horas se clasifican como **festivas nocturnas** y ese domingo cuenta como domingo trabajado, aunque hayan sido tres horas de madrugada.

### 15.3 Derivación de horas extras

Por cada día del periodo, el sistema:

1. Determina si es **domingo o festivo**, cruzando con `holidays`.
2. Arma los intervalos trabajados a partir de las marcas.
3. Corta a las **7 horas ordinarias**; lo que excede es extra, contado **cronológicamente desde el final del día**.
4. Marca cada hora como **diurna o nocturna** según la hora de corte nocturna.

De ahí salen las cinco cantidades:

| Fila del comprobante | De dónde sale |
|---|---|
| Recargo nocturno | Horas **ordinarias** después de la hora de corte nocturna |
| Extra diurna | Horas extras antes de la hora de corte |
| Extra nocturna | Horas extras después de la hora de corte |
| Extra diurna festiva | Igual, en domingo o festivo |
| Extra nocturna festiva | Igual, en domingo o festivo |

**Regla especial para domingos y festivos:** no se aplica el corte de las 7 horas. **Todas** las horas del día van a las filas festivas.

La razón es estructural: el domingo trabajado es **adicional** a los 6 días laborados, así que sus horas ordinarias no están pagadas en la fila de "días laborados" y el comprobante no tiene una fila donde ponerlas. Mandarlas a las filas festivas paga un poco de más —factor 2,15 contra 1,90— y nunca de menos.

**Ejemplo.** Un sábado de 2 p.m. a 10 p.m., con corte nocturno a las 7 p.m.:

| Tramo | Clasificación |
|---|---|
| 14:00 → 19:00 | 5 h ordinarias diurnas |
| 19:00 → 21:00 | 2 h ordinarias nocturnas → **recargo nocturno** |
| 21:00 → 22:00 | 1 h **extra nocturna** |

### 15.4 Visibilidad

- Cada empleado ve **sus propios** registros.
- **`ADMIN` y `MANAGER`** ven los de todos, vía el desplegable.

### 15.5 Edición

El empleado puede corregir sus registros solo si:

1. Pertenecen a la **semana actual** (la semana empieza el **lunes 00:00 hora de Medellín**), **o** son del **sábado de la semana inmediatamente anterior y aún es lunes** — el plazo vence el **lunes a las 11:59 p.m. inclusive**.
2. **No existe una liquidación pagada** que cubra ese día.

`ADMIN` y `MANAGER` pueden editar cualquier registro sin esas restricciones, para correcciones administrativas — pero **no si ya hay liquidación pagada**, porque eso haría que el comprobante firmado y el sistema difieran.

> **`timesheets` ya no lleva `paid_at` ni `paid_by`.** Antes existía un mecanismo aparte para marcar días como pagados. Ahora la liquidación **es** el registro del pago, así que el bloqueo se deriva de ella. Una sola fuente de verdad en lugar de dos que pueden contradecirse.

---

## 16. Liquidación de nómina

Módulo **semanal**, operado por `MANAGER` y `ADMIN`. Se liquida y paga cada semana para facilitarle la vida a los empleados. Produce un **comprobante imprimible por empleado**.

Reemplaza un archivo de Excel que hoy se copia semana a semana, con un bloque por empleado, valores digitados a mano y varios errores acumulados.

### 16.1 Una pantalla por empleado

Se liquida **de a un empleado a la vez**, no toda la nómina en una sola vista. Es una decisión deliberada: con cinco bloques en pantalla es fácil liquidar a alguien con los datos de otro, que es justo lo que pasa hoy en la hoja de cálculo.

### 16.2 Tarifas derivadas

Todo el cálculo se apoya en dos valores que salen del salario del empleado (`users.attributes.monthly_salary`):

```
valor_dia  = monthly_salary / PAYROLL_DAYS_PER_MONTH     (30)
valor_hora = monthly_salary / PAYROLL_HOURS_PER_MONTH    (210)
```

Los dos números son coherentes entre sí: 42 horas semanales ÷ 6 días = 7 horas al día, × 30 días = 210. Y `valor_dia / 7 = valor_hora`.

Con el salario mínimo de referencia: valor día 58.363,50 y valor hora 8.337,64.

### 16.3 Devengados

Nueve conceptos. Las **cantidades** de las cinco filas de horas vienen derivadas del registro de horas (15.3) y el gerente puede corregirlas; las demás las digita.

| Concepto | Etiqueta | Cantidad | Valor |
|---|---|---|---|
| `DAYS_WORKED` | Días laborados | días | `valor_dia × cantidad` |
| `SUNDAY_REST` | Descanso dominical x día | días | `valor_dia × cantidad` |
| `HOLIDAY_OVERTIME_DAY` | Horas extras diurnas festivas | horas | `valor_hora × 2,15` |
| `HOLIDAY_OVERTIME_NIGHT` | Horas extras nocturnas festivas | horas | `valor_hora × 2,65` |
| `OVERTIME_DAY` | Horas extras diurnas | horas | `valor_hora × 1,25` |
| `OVERTIME_NIGHT` | Horas extras nocturnas | horas | `valor_hora × 1,75` |
| `NIGHT_SURCHARGE` | Recargo nocturno | horas | `valor_hora × 0,35` |
| `TRANSPORT_ALLOWANCE` | Auxilio de transporte | días | `auxilio / 30 × cantidad` |
| `NON_SALARY_BONUS` | Bono no salarial | — | monto libre |

Notas:

- **Días laborados son normalmente 6**, y bajan cuando el empleado pide un día libre. El **descanso dominical se mantiene en 1** aunque bajen.
- **El auxilio se paga por 6 días, no por 7**: el domingo no se desplaza al trabajo.
- **El recargo nocturno se paga solo al 35%**, no la hora completa, porque esa hora ordinaria ya está pagada dentro de "días laborados". Los otros cuatro conceptos de hora sí se pagan completos con su recargo encima. Es el error más común al calcular a mano.
- **El bono no salarial es 100% manual.** Es un reconocimiento al sacrificio de un empleado, no una fórmula.

**Los factores festivos se arman sumando:** hora ordinaria (1,00) + recargo dominical/festivo (0,90) + el recargo de extra que corresponda (0,25 diurna o 0,75 nocturna). En la ley colombiana **el recargo dominical y el festivo son el mismo concepto con un solo porcentaje**, así que basta un parámetro y una condición: el día es domingo **o** está en `holidays`.

> Ese porcentaje sube a 100% en julio de 2027 según el cronograma de la reforma laboral. Por eso **todos los factores son parámetros de `settings`**, no constantes en el código.

### 16.4 Deducciones

| Concepto | Etiqueta | Origen |
|---|---|---|
| `PENSION` | Aporte pensión | `IBC × PAYROLL_PENSION_RATE` (4%) |
| `HEALTH` | Aporte salud | `IBC × PAYROLL_HEALTH_RATE` (4%) |
| `LOANS` | Préstamos | digitado |
| `OTHER` | Otros | digitado, **con descripción obligatoria** |

**La base de cotización (IBC) excluye el auxilio de transporte y el bono no salarial.**

```
IBC = total_devengado − auxilio_transporte − bono_no_salarial
```

Esto **corrige un error del archivo actual**, donde el 4% se aplica sobre el total devengado con el auxilio incluido. Sobre un salario mínimo son unos 4.000 pesos semanales de más que se le descuentan al empleado, cerca de 207.000 al año. El error se introdujo al pasar las fórmulas a valores digitados; en un bloque suelto de la misma hoja la fórmula sí excluía el auxilio.

**"Otros" exige descripción.** Es donde caen las reposiciones de equipo dañado por el empleado y los elementos de uniforme perdidos que se le cobran. Sin descripción, el trabajador firma un descuento que no puede identificar.

**Los préstamos se digitan cada semana.** El sistema **no lleva saldo ni cuotas**.

**El aporte patronal no se calcula en la app.** Lo liquida suaporte.com.co, donde los empleados ya están afiliados con su clase de riesgo de ARL correcta, y que responde por la planilla. Duplicarlo crearía una segunda fuente de verdad. El pago mensual a suaporte se registra como egreso en `cash_movements`.

### 16.5 Totales

```
total_earnings   = Σ earnings.amount
total_deductions = Σ deductions.amount
net_pay          = total_earnings − total_deductions
```

**Redondeo: cada línea se redondea al peso al calcularse, y el total es la suma de las líneas redondeadas.**

Es obligatorio porque las divisiones de nómina no dan enteros: `1.750.905 / 210 = 8.337,642857…`. Se evaluó guardar el dinero en centavos para reducir el arrastre y **se descartó**; el dinero sigue siendo entero de pesos completos, así que la política de redondeo es lo único que controla el error.

La alternativa —mantener precisión completa y redondear solo el total— produce un comprobante donde **las líneas impresas no suman el total impreso**. Puede ser un peso de diferencia, pero es el papel que el empleado está firmando.

### 16.6 Numeración de semanas

La empresa lleva **su propia cuenta**, que no coincide con la semana ISO. **Se reinicia en enero.**

El sistema **propone el número anterior + 1** y lo deja **editable**, para que nadie tenga que acordarse y para poder corregir un salto.

### 16.7 Congelamiento

La liquidación nace editable y **se congela al registrar el pago**.

Una sola acción del gerente hace tres cosas:

1. Marca la liquidación como pagada.
2. Graba un movimiento `PAYROLL` en `cash_movements`, enlazado por `payroll_run_id`.
3. Congela la liquidación: ya no se puede editar.

Coincide con el momento real en que se entrega la plata y el empleado firma el comprobante. Un error posterior se corrige con un movimiento contrario, igual que en los pagos de pedidos.

Congelar también **bloquea la edición de las marcas de horas** de ese periodo (15.5).

### 16.8 Comprobante impreso

Segundo formato de impresión de la aplicación, junto al del pedido (10.2). Media carta vertical, generado con CSS de impresión.

1. Logotipo y el título "PAGO DE NÓMINA".
2. Fecha de pago (distinta del fin del periodo).
3. Nombre, cédula, **cargo** y **fecha de ingreso** del empleado.
4. Periodo: número de semana y rango **de lunes a domingo**.
5. Tabla de devengados con cantidad y valor, y el total devengado.
6. Tabla de deducciones y el total.
7. **Neto a pagar.**
8. Texto de recibido conforme y **línea de firma del trabajador**.
9. "Elaboró:" con el nombre de quien preparó la liquidación.

---

## 17. Consulta pública del cliente

**La pantalla inicial de la aplicación es la consulta del cliente.** La ruta `/` está reservada para eso desde el principio; los empleados entran por un enlace **"Empleados"** en la esquina superior derecha, que lleva al login.

### 17.1 Qué se entrega en la fase 1

Un **marcador de posición**: fondo blanco, el logotipo centrado, y el enlace "Empleados" arriba a la derecha. Nada más. Sin formulario de consulta, sin texto de marketing.

Esto no es una pantalla desechable: es la ubicación definitiva del enlace de empleados y del logotipo, así que la fase 1 la deja en su sitio y las fases siguientes solo le agregan el buscador encima.

### 17.2 La consulta en sí — SIN FECHA

La funcionalidad de búsqueda **no está aprobada**. La empresa ya tiene un sitio en WordPress con cotizaciones y "Mis Pedidos", y aún no se ha decidido si esta app reemplaza esa parte. La decisión se tomará según los resultados del uso interno.

`orders.public_token` se conserva desde ahora: no cuesta nada y evita una migración si se aprueba.

Si se aprobara, funcionaría así:

El cliente ingresa **teléfono + fecha del evento** (estilo consulta de reserva de vuelo) y ve:

- Productos del pedido
- Estado actual (traducido con `ORDER_STATUS_LABELS`)
- Costo de despacho
- Hora aproximada de entrega

Requisitos: teléfono normalizado antes de comparar, rate limiting, y URL basada en `public_token` y no en el `id` secuencial (ver 4.3).

**Ojo con la zona horaria:** algunos clientes consultan desde el exterior. Las fechas mostradas son fechas civiles y no se convierten. Cualquier cálculo de "hoy" usa `COMPANY_TIMEZONE`, nunca la zona del visitante.

---

## 18. Notificaciones

Envío automático al cliente en momentos clave: confirmación del pedido, recordatorio, "pedido en camino". Se dispara como llamada saliente al cambiar el estado del pedido.

### 18.1 Correo con Mailgun

El canal es **correo electrónico**, usando [Mailgun](https://www.mailgun.com/).

**El plan gratuito permite hasta 100 correos diarios**, y el volumen de esta empresa cabe con holgura: entre 5 y 10 pedidos al día por unas 3 notificaciones da 15–30 correos, y menos todavía porque el email del cliente es opcional.

Se llama por **REST API** desde el Worker, con un `fetch` normal:

```ts
await fetch(`https://api.mailgun.net/v3/${DOMINIO}/messages`, {
  method: 'POST',
  headers: { Authorization: 'Basic ' + btoa(`api:${env.MAILGUN_API_KEY}`) },
  body: new URLSearchParams({
    from: 'Banquetes Consuelo C <pedidos@consueloc.com>',
    to: cliente.email,
    subject: 'Su pedido fue confirmado',
    text: '…',
    html: '…'
  })
});
```

Lo que hay que montar:

- **`MAILGUN_API_KEY` en `wrangler secret`.** A diferencia de un binding nativo, aquí sí hay una clave de terceros que administrar. Es lo único que falta montar.
- **Usar la región correcta** al construir la URL: la API de EE. UU. y la europea tienen dominios distintos, y equivocarse da errores de autenticación difíciles de diagnosticar.

> **El dominio ya está listo.** `consueloc.com` está configurado en Mailgun con SPF, DKIM y **DMARC**.
>
> Que haya DMARC tiene una consecuencia para la implementación: **el remitente tiene que ser una dirección de `consueloc.com`**. Un `from` de otro dominio será rechazado por los servidores receptores, no simplemente marcado como spam. No usar direcciones de prueba tipo `sandbox` ni `example.com` ni siquiera en desarrollo.

> **Se evaluó Cloudflare Email Service y se descartó.** Tiene la ventaja de ser un binding nativo sin clave externa, pero el envío está **en beta** y requiere el **plan Workers Paid** para escribirle a direcciones no verificadas — es decir, a los clientes. Mailgun cubre el volumen sin costo y está estable.

> Mailgun también permite **recibir** correos y enrutarlos. No se usa en esta aplicación, pero está disponible si algún día se quiere que los pedidos entren por correo.

### 18.2 WhatsApp — DIFERIDO

**No se construye.** Requeriría un proveedor de WhatsApp Business API (Twilio, Meta Cloud API, Gupshup) y plantillas pre-aprobadas, y se decidió posponerlo indefinidamente a favor del correo.

Lo único que se conserva desde ahora es una precaución de diseño: **el envío se implementa detrás de una interfaz común**, de modo que agregar WhatsApp más adelante —o usar los dos canales— no toque la lógica de pedidos.

---

## 19. Interfaz

**La aplicación es móvil primero.** Se usa principalmente desde teléfono: el conductor marca estados en la calle, bodega registra novedades con fotos, ventas captura pedidos mientras habla con el cliente. El escritorio solo importa para la toma de pedidos, y ahí es **la misma interfaz con campos más anchos**, no un diseño aparte.

- **Navegación inferior** con 3–4 destinos en móvil; esos mismos destinos como **barra lateral colapsable con iconos** en escritorio.
- La navegación muestra la **unión** de las secciones de todos los roles del usuario, así que debe funcionar con 2, 3 o 5 destinos.
- **Legibilidad al aire libre**: texto oscuro sobre fondo claro y contraste alto. El conductor usa la app al sol.
- **Objetivos táctiles de mínimo 48px** en todo control que usen bodega o conductor, y una sola acción primaria por pantalla.
- Las tablas densas (búsqueda de pedidos, horas del equipo) se vuelven **tarjetas apiladas** en móvil, con los filtros en una hoja desplegable.
- La grilla de productos del pedido **no puede ser una tabla de cinco columnas en móvil**; requiere un patrón propio (tarjetas, fila expandible o captura en dos pasos).
- **La landing es la consulta del cliente** (ver 17), que en la fase 1 se entrega como logo + enlace "Empleados" arriba a la derecha. El login vive en su propia ruta.
- **Colores de marca:** `#FFD313` (amarillo dorado), `#333333` (gris oscuro), `#FFFFFF`. El amarillo **no puede usarse como color de texto** —contraste ~1.5:1 sobre blanco—; sirve como fondo de badge, relleno de botón con texto `#333333` encima, o acento. Los ocho estados del pedido y las advertencias necesitan una escala semántica aparte (verde, ámbar, rojo, azul).
- **No hay selección de tema light/dark.** Un solo esquema de color definido en el CSS. No hay toggle, no hay cookie de preferencia, no se usa `prefers-color-scheme`.
- La pantalla de toma de pedidos es **una sola vista**, no un wizard.
- En el login **no va** el enlace de "olvidé mi contraseña".
- **Toda la interfaz está en español.** Los valores en inglés que vienen de la base de datos se traducen con los mapas de la sección 2.4.

---

## 20. Reglas duras para la implementación

Resumen operativo. Todas se justifican en las secciones anteriores. **Se citan por nombre, no por número**: la numeración es solo para recorrer la lista.

**Arquitectura**
1. La lógica de negocio vive en `src/lib/server/services/`. Las rutas de SvelteKit solo resuelven el actor, invocan el servicio y renderizan.
2. Los servicios reciben `(input, actor)` y no saben nada del transporte: ni cookies, ni `locals`, ni `Request`.
3. `requireRole` recibe un **actor resuelto**, nunca `locals`.
4. Las columnas de auditoría se llenan siempre desde `actor.email`, en una capa común, no en cada endpoint.

**Nomenclatura**
5. Código, columnas y valores de enumeración en **inglés**. Documentación y UI en **español**.
6. Ningún valor crudo de enumeración llega a la pantalla: todo pasa por los mapas de etiquetas.

**Datos**
7. Dinero siempre en `INTEGER` de **pesos completos**, nunca `REAL`, nunca centavos. Cada línea se redondea al peso al calcularse; los totales son la suma de las líneas redondeadas.
8. Todo JSON se valida con **Zod** al escribir y al leer, y **toda entrada de formulario o endpoint se valida con Zod en el servidor**. SQLite no valida nada.
9. Nada se borra: usuarios y productos se desactivan, pedidos se cancelan, novedades se reversan, movimientos se contrarrestan.
10. Los precios y nombres se **congelan** en el pedido al momento de crearlo; la liquidación guarda `settings_snapshot` con los valores usados.
11. Una novedad ajusta el inventario **solo** por los productos con `outcome` `LOST` o `UNRECOVERABLE`.
12. El inventario, las novedades y los conteos operan sobre la **variante**, no sobre el grupo. Las variantes no tienen fila padre.
13. `settings` guarda **un solo valor vigente** por clave, sin vigencias por fecha. Las claves llevan prefijo de módulo; módulo, etiqueta, unidad y esquema viven en `src/lib/settings.ts`, no en una columna. Solo `ADMIN` y `MANAGER` editan valores.

**Fechas**
14. Prohibido `new Date().toISOString().slice(0,10)`. Usar `getTodaysDate()`.
15. Prohibido `date('now')` / `datetime('now')` de SQLite para lógica de negocio.
16. Toda la lógica de negocio pasa `COMPANY_TIMEZONE`. La zona del visitante solo sirve para presentación.
17. Los valores de `<input type="date">` van tal cual a la base, sin convertir a `Date`.

**Seguridad**
18. `requireRole(actor, [...])` como primera línea de cada endpoint y cada `load` del servidor.
19. Los permisos son por **roles múltiples**: usar `hasAnyRole()`, nunca comparación directa.
20. **Propiedad del recurso (anti-IDOR):** cuando un recurso pertenece a un usuario —como sus marcas de horas—, la consulta filtra por el actor autenticado. Nunca se confía en un `user_id` que venga del cliente, salvo que el actor sea `ADMIN` o `MANAGER` usando el desplegable.
21. La URL pública del pedido usa `public_token`, nunca el `id`. El token se genera con **`crypto.randomUUID()`** o al menos 16 bytes de `crypto.getRandomValues()`; jamás `Math.random()`.
22. La sesión dura **30 días** (`expires_at` inicial) con expiración deslizante. En la tabla vive el SHA-256 del token, nunca el token.
23. **No deshabilitar el `checkOrigin` de SvelteKit** (su protección CSRF). No configurar `csrf: { checkOrigin: false }`.
24. El **rate limiting del login no se implementa en el código**: se configura en Cloudflare (WAF / rate limiting de plataforma). El de la consulta pública, si se aprueba esa fase, sí va en código.
25. **R2 nunca es público.** Las fotos se suben a través del Worker con `requireRole` (MIME de imagen, máximo 5 MB) y se sirven por un endpoint autenticado que hace stream desde el bucket. Sin URLs públicas ni buckets abiertos. La retención de `incidents/` se resuelve con una **regla de ciclo de vida a 365 días**, no con código.
26. **El seed de datos de ejemplo corre solo en desarrollo.** En producción, el primer administrador se crea con una contraseña provista por variable de entorno o `wrangler secret`; **ninguna contraseña literal en el repositorio**.
27. Las transiciones **operativas** no se restringen por rol, pero exigen sesión válida y transición legal. Solo las **comerciales** llevan candado de rol.
28. La validez de una transición depende del estado actual **y de `delivery_method` / `return_method`**. Una sola función lo decide.

**Nómina y horas**
29. Las cantidades de horas del comprobante **se derivan del registro de horas** (15.3) y el gerente puede corregirlas antes de liquidar.
30. Los factores de recargo, la jornada, el divisor de días y la hora de corte nocturna son **parámetros de `settings`**, nunca constantes.
31. En domingo y festivo **no se aplica el corte de 7 horas**: todas las horas van a las filas festivas.
32. El recargo dominical y el festivo son **un solo concepto con un solo porcentaje**.
33. La base de cotización (IBC) **excluye el auxilio de transporte y el bono no salarial**.
34. El aporte patronal **no se calcula en la app**: lo liquida suaporte. Solo se registra el egreso mensual.
35. `timesheets` **no tiene campos de pago**: el bloqueo se deriva de la liquidación `PAID`.
36. La liquidación se congela **al registrar el pago**, no al imprimir.

**Caja**
37. Toda la plata va a `cash_movements`. El signo indica la dirección; no hay columna de "entrada/salida".
38. Los enlaces de un movimiento son **llaves foráneas nulas y tipadas**, nunca `subject_type` + `subject_id`.
39. No hay rutas de edición ni borrado para `cash_movements` ni `order_events`. La corrección es un movimiento contrario.
40. El conductor **no registra pagos**: deja notas en el pedido. El movimiento se registra cuando la plata llega a la oficina.
41. El libro de caja **no cuadra efectivo**: no hay saldo inicial ni control de quién tiene el dinero.
42. No se lleva saldo de préstamos por empleado: se digita cada semana.

**Cosas que NO hay que construir**
43. No hay transacciones ni reservas de inventario, ni validación que bloquee por sobrecupo, monto mínimo o choque de horario: **las advertencias nunca bloquean**.
44. No hay IVA ni campos de impuestos.
45. No hay recuperación de contraseña por correo, ni tema oscuro.
46. No hay tabla de transportadores: `carrier_name` y `carrier_phone` son texto libre en el pedido.
47. No se registra lo que la empresa le paga al transportador externo.
48. El sistema **no decide** si se retiene el depósito: solo registra responsable y desenlace.
49. **No hay acción de "reparado"** sobre una novedad recuperable. Lo resuelve el conteo parcial. Los conteos que se solapan advierten, no bloquean; gana la última aprobación.
50. El modo sin conexión es **solo lectura**: sin cola, ni reintentos, ni bucle verificando la señal. El caché se guarda con su fecha; si no es la de hoy, no se muestra.
51. La impresión se hace con CSS (`@page`), **no con librería de PDF**.
52. La ruta `/` es la consulta del cliente, no el login.
53. Los precios de esta aplicación mandan sobre los de cualquier pedido entrante.
54. **No hay nada de MCP ni de webhooks todavía**: solo se respeta la separación transporte/servicios de la sección 2.8. Ningún transporte contiene lógica de negocio.

**CI/CD y entornos**
55. El despliegue es automático por push (GitHub Actions): `main` → producción, `staging` → staging. `wrangler deploy` manual no es el flujo normal, solo sirve para depurar.
56. El token que autentica el workflow contra Cloudflare vive en **GitHub Secrets**, nunca en `wrangler secret` ni en el repositorio, y tiene permisos acotados — nunca el token global de cuenta.
57. Producción y staging **nunca comparten base D1 ni bucket R2**.
58. El workflow corre Vitest antes de desplegar; si los tests fallan, no llega a aplicar migraciones ni a `wrangler deploy`.
59. La URL de staging queda detrás de **Cloudflare Access**. La de producción no — su control de acceso es el login de la aplicación.

---

## 21. Fases de desarrollo

| # | Fase | Contenido |
|---|---|---|
| **0** | Entorno y base | SvelteKit + `adapter-cloudflare`, `wrangler` (entornos `production` y `staging`), D1, R2, Drizzle, **estructura de la capa de servicios y el tipo `Actor`**, **PWA completa: manifiesto, iconos, service worker e instalabilidad**, helpers de fecha y auditoría, migraciones de las tablas de la fase (`users`, `clients`, `products`, `orders`, `holidays`, `settings`), seed de desarrollo, **CI/CD con GitHub Actions (producción y staging)** |
| **1** | Autenticación | `users`, `sessions`, login, hooks, `requireRole`, gestión de empleados, restablecer contraseña, **landing con logo y enlace "Empleados"** |
| **2** | Shell del dashboard | Navegación (inferior en móvil, lateral en escritorio), layout, mapas de etiquetas, días festivos |
| **3** | **Registro de horas** | `timesheets`, captura por el empleado y por el gerente vía desplegable, derivación de horas extras |
| **4** | **Liquidación de nómina** | `payroll_runs`, pantalla por empleado, congelamiento al pagar, comprobante impreso, pantalla de configuración |
| **5** | Catálogo | Clientes y productos **con variantes**, subida de fotos a R2 |
| **6** | Pedidos | Toma de pedidos, disponibilidad, totales, `cash_movements`, `order_events`, búsqueda, **impresión en media carta** |
| **7** | Operación | Despachos, recogidas, transiciones de estado, `incidents`, **modo sin conexión** |
| **8** | Conteo físico | `inventory_counts`, aprobación, reversión |
| **9** | Consulta pública — **condicional** | Solo si se aprueba la sección 17. Landing pública, búsqueda por teléfono + fecha, rate limiting |
| **10** | Notificaciones | Correo con Mailgun, detrás de una interfaz común. WhatsApp queda diferido |

**Nómina va cuarta y el registro de horas tercero.** El dueño de este proyecto va a ejercer como gerente, y la nómina es el módulo que le sirve desde el primer día — pero **depende del registro de horas**, porque de ahí se derivan las horas extras (15.3). El módulo de horas es pequeño y funciona como prerequisito.

Se descartó construir la nómina antes con captura manual y automatizar después: se decidió hacerlo todo junto.

**Nota sobre migraciones:** se crean conforme se necesiten en cada fase, **excepto las tablas núcleo**, que van completas en la fase 0. `products` va en la fase 0 **ya con `variant_group` y `variant_name`**, y `users` **ya con `id_number` y `attributes`**, aunque se usen después.

**`holidays` y `settings` van en la fase 0** aunque sus pantallas lleguen en las fases 2 y 4: el seed carga los festivos y los parámetros por defecto, y la derivación de horas de la fase 3 **lee `settings`** — sin la tabla, esa fase no puede cumplir sus criterios. En SQLite modificar una columna obliga a recrear la tabla, así que es más barato definirlas bien desde el principio aunque se llenen después.

---

## 22. No funcional

- **Entornos:** staging y producción separados — bases D1, buckets R2 y Workers distintos (ver 2.9). Staging protegido con Cloudflare Access; producción no.
- **Despliegue:** automático vía GitHub Actions por push (`main` → producción, `staging` → staging), no `wrangler deploy` manual (ver 2.9).
- **Secretos de la aplicación** (`MAILGUN_API_KEY`, contraseña del admin del seed): vía `wrangler secret`, nunca en el repositorio. **Secreto del despliegue** (token de Cloudflare para GitHub Actions): vía GitHub Secrets, tampoco en el repositorio — es una superficie distinta con el mismo principio.
- **Seed:** datos de desarrollo idempotentes (usuarios de cada rol, productos de ejemplo, festivos), todos con `created_by = 'system@seed'`.
- **Pruebas:** Vitest para lógica (disponibilidad, totales, reglas de fecha, permisos) y Playwright para los flujos críticos.
- **Respaldo:** Time Travel de D1 (recuperación a un punto en el tiempo, sin configuración adicional).
- **Desarrollo local:** `wrangler dev` usa un SQLite real en disco.

---

## 23. Pendiente por definir

Nada de esto bloquea las fases 0 a 4.

**Configuración externa, antes de la fase que la usa**
- `MAILGUN_API_KEY` en `wrangler secret` — fase 10. El dominio ya tiene SPF, DKIM y DMARC.
- Regla de ciclo de vida de R2 a 365 días sobre `incidents/` — fase 7 (2.7).

**Decisiones de producto**
- Si se construye la **consulta pública del cliente** — fase 9. Se decide viendo cómo funciona el uso interno.

**Trabajo de diseño**
- Wireframes por pantalla y por rol, a partir de lo que produzca Claude Design.

**Trabajo de especificación**
- Criterios de aceptación de las **fases 5 a 10**. Los de 0 a 4 ya existen; conviene escribir los siguientes cerca del momento, con lo aprendido en las primeras.

**Detalles menores que Claude Code preguntará**
- De dónde sale el "Elaboró:" del comprobante de nómina (presumiblemente el nombre del actor que liquida).
- Quién fija la `payment_date` de la liquidación, que es distinta del fin del periodo.

**Diferido a propósito, no pendiente**
- Servidor MCP y webhooks de WordPress (2.8) · WhatsApp (18.2). La arquitectura los admite; no se construye nada.
