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
- [ ] `src/lib/datetime.ts`
- [ ] `src/lib/schemas.ts`, `labels.ts`, `settings.ts`
- [ ] `src/lib/server/actor.ts`, `audit.ts`, `services/README.md`
- [ ] Drizzle: las 6 tablas + migración generada
- [ ] Seed idempotente: admin por variable de entorno, festivos 2026–2027,
      valores por defecto de `settings`, ~10 productos con un grupo de variantes
- [ ] Vitest: `getTodaysDate` (incluido el caso de las 7 p.m. en Colombia) y
      permisos con usuarios multi-rol
- [ ] PWA: copiar `marca/` a `static/`, manifiesto, service worker, `/` prerenderizada
- [ ] `.github/workflows/deploy.yml`
- [ ] `wrangler.jsonc` con `env.production` y `env.staging` — **bloqueado**

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

## Pendiente de Mario (bloquea cerrar la fase 0)

**Cloudflare** — sin esto no se puede escribir `wrangler.jsonc`:

- `account_id`
- Nombre del Worker en producción y en staging
- Nombre y `database_id` de la D1 de producción
- Nombre y `database_id` de la D1 de staging
- Nombre del bucket R2 de producción y del de staging

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
