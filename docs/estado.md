# Estado del proyecto

Dónde va el trabajo, qué se decidió y qué falta. **Se actualiza al cerrar cada
hito**, junto con el commit correspondiente.

Última actualización: 2026-08-21.

## Fase actual

**Fase 0 — Entorno y base.** Las once fases están en la sección 21 de
`planeacion.md`. No adelantar trabajo de fases posteriores.

En la base solo existen las **seis** tablas de la fase 0 —`users`, `clients`,
`products`, `orders`, `holidays`, `settings`—; las otras siete se crean en su
fase. `users` ya trae `id_number` y `attributes`; `products`, ya `variant_group`
y `variant_name`, aunque no se usen todavía.

## Fase 0 — avance

- [x] Scaffold SvelteKit + adapter-cloudflare + Drizzle D1 + Vitest; Zod instalado
- [x] `CLAUDE.md`, `docs/reglas-duras.md`, `docs/estado.md`
- [x] `src/lib/datetime.ts` + prueba (incluido el caso de las 7 p.m. en Colombia)
- [ ] `src/lib/schemas.ts`, `labels.ts`, `settings.ts`
- [ ] `src/lib/server/actor.ts`, `audit.ts`, `services/README.md`
- [ ] Drizzle: las 6 tablas + migración generada
- [ ] Seed idempotente: admin por variable de entorno, festivos 2026–2027,
      valores por defecto de `settings`, ~10 productos con un grupo de variantes
- [ ] Vitest: `getTodaysDate` (incluido el caso de las 7 p.m. en Colombia) y
      permisos con usuarios multi-rol
- [ ] PWA: manifiesto, service worker, `/` prerenderizada con el logotipo
- [ ] `.github/workflows/deploy.yml`
- [x] `wrangler.jsonc` con `env.production` y `env.staging`

## Plan: despliegue de humo a staging antes de cerrar la fase 0

Se decidió desplegar staging temprano para validar la configuración de
Cloudflare y de GitHub Actions antes de que haya código encima. **No cambia la
planeación** —la sección 21 ya pone el CI/CD dentro de la fase 0—, solo el orden
interno de la fase.

1. `datetime.ts` + su prueba: `vitest run` sale con código 1 si no encuentra
   ningún archivo de prueba y el workflow se detendría ahí.
2. `/` con el logotipo + PWA: algo que mirar en la URL de staging.
3. `.github/workflows/deploy.yml`, con `migrations/.gitkeep` para que
   `wrangler d1 migrations apply` reporte "nada que aplicar" en vez de fallar.
4. Después, las seis tablas + migración + seed: ese despliegue es el que valida
   de verdad la conexión a D1, porque ya hay migraciones que aplicar.

**Crear también los recursos de producción**, no solo los de staging: el
workflow despliega producción al hacer push a `main`, que es la rama de trabajo.
**Activar Cloudflare Access sobre staging después** del primer despliegue, para
no confundir un 403 de Access con un error de despliegue.

## Decisiones tomadas (no volver a preguntar)

- Gestor de paquetes: **npm**.
- **Mario hace los commits.** Claude sugiere el mensaje al cerrar cada hito y
  pregunta si ya se hizo antes de seguir.
- Admin del seed: `marioy47@gmail.com` / Mario Yepes, roles `["ADMIN"]`.
  La contraseña se lee de `SEED_ADMIN_PASSWORD`, nunca literal.
- Secreto de GitHub: `CLOUDFLARE_API_TOKEN`. Ramas: `main` y `staging`.
- `src/routes/+page.svelte` en la fase 0 es **solo infraestructura**: el logo y
  nada más, prerenderizada para que el service worker tenga shell que cachear.
  La landing real de la sección 17.1, con el enlace "Empleados", es fase 1.
- Los valores por defecto de `settings` van en el seed, no en `settings.ts`: la
  sección 5.12.1 solo le asigna módulo, etiqueta, unidad y esquema.
- Derivados de la planeación, no inventados: `PAYROLL_MINIMUM_WAGE = 1750905`
  (§16.2, valor día 58.363,50 × 30) y `PAYROLL_TRANSPORT_ALLOWANCE = 249095`
  (§16.3, 49.819 por 6 días).

## Recursos de Cloudflare

`account_id` `d3898719718f3c05aa6c5bb85a15ea95`. Los bindings se llaman **`DB` y
`PHOTOS` en los dos entornos**, apuntando a recursos distintos: el código nunca
sabe en qué entorno corre.

| | Producción | Staging |
|---|---|---|
| Worker | `consueloc-erp` | `consueloc-erp-staging` |
| D1 | `consueloc-db-prod` | `consueloc-db-stg` |
| R2 | `consueloc-buck-prod` | `consueloc-buck-stg` |

En desarrollo, `vite dev` usa la configuración del entorno staging vía
`platformProxy`, pero con la simulación local de Miniflare: D1 y R2 viven en
`.wrangler/state` y el recurso remoto nunca se toca.

`worker-configuration.d.ts` va versionado aunque sean 572 KB generados, porque
`npm run build` corre `wrangler types --check` y falla si está ausente o
desactualizado. **Al cambiar `wrangler.jsonc` hay que correr `npx wrangler types`.**

## Pendiente de Mario

**`settings`** — sin esto el seed queda incompleto (no bloquea la fase 0, sí la 4):

- `COMPANY_ADDRESS`, `COMPANY_PHONE`
- `ORDERS_SUGGESTED_ADVANCE_PCT` y su unidad: ¿porcentaje entero (`50`) o puntos
  básicos (`5000`)? La planeación solo fija puntos básicos para los factores de
  nómina, así que aquí está ambiguo.

## Configuración externa, fuera del repo

- **GitHub Secrets:** `CLOUDFLARE_API_TOKEN` con permisos acotados (Workers
  Scripts, D1, R2). Nunca el token global de cuenta.
- **Cloudflare Access** sobre la URL de staging (fase 0/1).
- **Rate limiting** del login en el WAF de Cloudflare (fase 1).
- **Regla de ciclo de vida de R2** a 365 días sobre `incidents/` (fase 7).
- **`wrangler secret`:** `SEED_ADMIN_PASSWORD`, y `MAILGUN_API_KEY` en la fase 10.
