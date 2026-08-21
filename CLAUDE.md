# CLAUDE.md — App de Pedidos, Banquetes Consuelo C

Herramienta **interna** de alquiler de menaje para eventos (Medellín). 5 empleados,
5–10 pedidos/día, catálogo ≤60 productos.

## Qué leer y cuándo

| Archivo | Cuándo |
|---|---|
| `docs/estado.md` | **Al empezar cada sesión.** Fase actual, avance, decisiones tomadas, qué falta. |
| `docs/reglas-duras.md` | **Antes de escribir código de negocio.** Las 59 reglas de la sección 20 y las trampas de D1. |
| `docs/planeacion.md` | Al construir una fase: especificación completa. Es la fuente de verdad. |
| `docs/brief-diseno.md` | Al construir pantallas: identidad visual, colores, pantallas. |

Si este archivo contradice la planeación, gana la planeación.

## Stack

SvelteKit 2 + Svelte 5 (runes) · `adapter-cloudflare` (target `workers`) · D1 ·
R2 (privado) · Drizzle + `wrangler d1 migrations apply` · Zod · Vitest ·
sesiones propias con PBKDF2-SHA256 vía WebCrypto (~600.000 iteraciones) ·
zona `America/Bogota` · pesos colombianos enteros.

## Comandos

```bash
npm install
npm run dev              # vite dev
npm run check            # svelte-check + tipos de wrangler
npm test                 # vitest run

npm run db:generate      # schema.ts → SQL en migrations/
npm run db:migrate:local | :staging | :prod

npm run seed:local | :staging     # incluye datos de ejemplo
npm run seed:prod                 # solo admin + festivos + settings
```

El seed exige `SEED_ADMIN_PASSWORD` en el entorno. Ninguna contraseña literal
en el repositorio.

**Desplegar no es un comando.** Push a `main` → producción; push a `staging` →
staging, vía `.github/workflows/deploy.yml`: `npm ci` → `vitest run` →
`npm run build` → migraciones D1 del entorno → `wrangler deploy` del entorno.
Si los tests fallan no toca la base ni despliega. `wrangler deploy` a mano solo
sirve para depurar; no lo sugieras como forma de publicar.

El token es `secrets.CLOUDFLARE_API_TOKEN` en **GitHub Secrets**, acotado. No es
un `wrangler secret` y no va en ningún archivo. Los secretos de *aplicación*
(`MAILGUN_API_KEY`, contraseña del seed) sí van por `wrangler secret`.

## Estructura

```
docs/            planeacion.md · brief-diseno.md · reglas-duras.md · estado.md
static/          logotipos, iconos PWA, manifiesto, robots.txt
migrations/      SQL generado por drizzle-kit
scripts/seed.ts  seed idempotente → SQL por stdout
src/
  service-worker.ts    cachea el shell (PWA desde la fase 0)
  lib/
    datetime.ts   COMPANY_TIMEZONE · getTodaysDate() · nowEpoch()
    labels.ts     mapas ES de los enums (sección 2.4)
    schemas.ts    enums + Zod de los campos JSON
    settings.ts   claves de settings: módulo, etiqueta, unidad, schema
    server/
      actor.ts    Actor + hasRole/hasAnyRole/isAdmin/isAdminOrManager/requireRole
      audit.ts    withCreate/withUpdate — llenan created_*/updated_*
      db/         schema.ts (tablas Drizzle) · index.ts (getDb)
      services/   TODA la lógica de negocio — ver services/README.md
  routes/         transporte delgado: actor → servicio → render
```

## Nomenclatura (sección 2.4)

1. Código, columnas y **valores de enum en inglés**.
2. Documentación y UI **en español**.
3. Ningún valor crudo de enum llega a la pantalla: todo pasa por `labels.ts`.

## Cómo trabajar

- **Mario hace los commits.** Nunca correr `git commit` ni `git add`. Al cerrar
  cada hito: sugerirle el mensaje y preguntarle si ya lo hizo antes de seguir
  con el siguiente. Hitos pequeños, no uno por sesión.
- Al cerrar un hito, actualizar también el avance en `docs/estado.md`.
- Ante una contradicción o un hueco en la planeación, **parar y preguntar**. El
  documento salió de una revisión larga; casi todo lo raro es deliberado.
- No inventar valores ni usar marcadores de posición: si falta un dato, pedirlo.
