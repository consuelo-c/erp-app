# Reglas duras

Condensado operativo de la **sección 20** de `planeacion.md`, más las trampas de
D1 de las secciones 2.1–2.3. La justificación de cada regla está en la sección
que la origina; aquí solo va el enunciado.

**Leer este archivo antes de escribir código de negocio.** Casi todas estas
reglas son contraintuitivas a propósito y son justo las que se "corrigen" por
descuido.

## Arquitectura

1. La lógica de negocio vive en `services/`; las rutas solo resuelven actor, invocan y renderizan.
2. Los servicios reciben `(input, actor)`; no saben de cookies, `locals` ni `Request`.
3. `requireRole` recibe un actor resuelto, nunca `locals`.
4. Las columnas de auditoría se llenan desde `actor.email` en una capa común.

## Nomenclatura

5. Código, columnas y valores de enum en **inglés**; documentación y UI en **español**.
6. Ningún valor crudo de enum llega a la pantalla: todo pasa por `labels.ts`.

## Datos

7. Dinero `INTEGER` en pesos completos, nunca `REAL` ni centavos. Se redondea por línea; el total suma líneas redondeadas.
8. Zod valida todo JSON al leer y escribir, y toda entrada de formulario/endpoint en el servidor.
9. Nada se borra: se desactiva, se cancela, se reversa, se contrarresta.
10. Precios y nombres se congelan en el pedido; la liquidación guarda `settings_snapshot`.
11. Una novedad ajusta inventario solo por `LOST` y `UNRECOVERABLE`.
12. Inventario, novedades y conteos operan sobre la **variante**; las variantes no tienen fila padre.
13. `settings`: un valor vigente por clave, sin vigencias. Prefijo de módulo en la clave; metadatos en `settings.ts`, **no una columna `module`**. Editan `ADMIN` y `MANAGER`.

## Fechas

14. Prohibido `new Date().toISOString().slice(0,10)`; usar `getTodaysDate()`.
15. Prohibido `date('now')` / `datetime('now')` de SQLite para lógica de negocio.
16. La lógica de negocio pasa siempre `COMPANY_TIMEZONE`; la zona del visitante es solo presentación.
17. Los valores de `<input type="date">` van tal cual a la base.

## Seguridad

18. `requireRole(actor, [...])` como primera línea de cada endpoint y `load`.
19. Roles múltiples: `hasAnyRole()`, nunca comparación directa.
20. Anti-IDOR: los recursos propios se filtran por el actor; nunca se confía en un `user_id` del cliente, salvo `ADMIN`/`MANAGER` con el desplegable.
21. La URL pública usa `public_token` (`crypto.randomUUID()`), nunca el `id` ni `Math.random()`.
22. Sesión de 30 días con expiración deslizante; en la tabla vive el SHA-256 del token.
23. **No deshabilitar `checkOrigin`** de SvelteKit.
24. El rate limiting del login se configura en Cloudflare, no en código. El de la consulta pública sí iría en código.
25. **R2 nunca público**: subida y lectura por el Worker con `requireRole` (MIME de imagen, ≤5 MB). Retención de `incidents/` por regla de ciclo de vida a 365 días, no por código.
26. Los datos de ejemplo del seed solo corren en desarrollo; la contraseña del primer admin viene por variable de entorno.
27. Las transiciones operativas no se restringen por rol, pero exigen sesión y transición legal. Solo las comerciales llevan candado.
28. La validez de una transición depende del estado **y** de `delivery_method`/`return_method`. Una sola función lo decide.

## Nómina y horas

29. Las horas del comprobante se derivan del registro de horas; el gerente puede corregirlas.
30. Factores, jornada, divisores y corte nocturno son parámetros de `settings`, nunca constantes.
31. En domingo y festivo no se aplica el corte de 7 horas: todo va a las filas festivas.
32. Recargo dominical y festivo son un solo concepto con un solo porcentaje.
33. El IBC excluye auxilio de transporte y bono no salarial.
34. El aporte patronal no se calcula en la app (lo liquida suaporte); solo se registra el egreso.
35. `timesheets` no tiene campos de pago: el bloqueo se deriva de la liquidación `PAID`.
36. La liquidación se congela al registrar el pago, no al imprimir.

## Caja

37. Toda la plata va a `cash_movements`; el signo da la dirección, sin columna de entrada/salida.
38. Los enlaces son FK nulas y tipadas, nunca `subject_type` + `subject_id`.
39. Sin rutas de edición ni borrado en `cash_movements` ni `order_events`: se corrige con un movimiento contrario.
40. El conductor no registra pagos; deja notas en el pedido.
41. El libro de caja no cuadra efectivo: sin saldo inicial ni control de quién tiene el dinero.
42. Sin saldo de préstamos: se digita cada semana.

## Cosas que NO hay que construir

43. Sin transacciones, sin reservas de inventario, sin bloqueo por sobrecupo/monto/choque: **las advertencias nunca bloquean**.
44. Sin IVA ni campos de impuestos.
45. Sin recuperación de contraseña, sin tema oscuro.
46. Sin tabla de transportadores: `carrier_name`/`carrier_phone` son texto libre.
47. No se registra lo que la empresa le paga al transportador externo.
48. El sistema no decide si se retiene el depósito: solo registra responsable y desenlace.
49. Sin acción de "reparado": lo resuelve el conteo parcial. Conteos solapados advierten; gana la última aprobación.
50. Modo sin conexión **solo lectura**: sin cola, reintentos ni polling. El caché lleva su fecha; si no es hoy, no se muestra.
51. Impresión con CSS `@page`, sin librería de PDF.
52. La ruta `/` es la consulta del cliente, no el login.
53. Los precios de esta app mandan sobre los de cualquier pedido entrante.
54. Nada de MCP ni webhooks todavía: solo la separación transporte/servicios.

## CI/CD y entornos

55. Despliegue automático por push; `wrangler deploy` manual solo para depurar.
56. El token de despliegue vive en GitHub Secrets, acotado, nunca en el repo.
57. Producción y staging **nunca comparten D1 ni R2**.
58. Vitest corre antes de migrar y desplegar.
59. Staging va detrás de Cloudflare Access; producción no.

## Trampas de D1

- **Sin transacciones** (`BEGIN` falla) y sin rollback de migraciones. `ALTER TABLE`
  de SQLite es limitado: cambiar tipo, `CHECK` o FK obliga a recrear la tabla y
  copiar los datos. Por eso las tablas núcleo van completas desde la fase 0.
- **No existen** `uuid`, `jsonb`, `timestamp`, `date`, `time`, `enum`, `boolean`.
  Fecha → `TEXT` `YYYY-MM-DD` · hora → `TEXT` `HH:MM` · instante → `INTEGER` epoch
  en segundos UTC · bool → `INTEGER` 0/1 · enum → `TEXT` + `CHECK` · dinero →
  `INTEGER` · JSON → `TEXT` validado con Zod.
- **La disponibilidad de inventario puede ser negativa y es válida.** Nunca
  `Math.max(0, …)` ni validación que bloquee por sobrecupo.
- **Sin bcrypt ni argon2** (son bindings nativos de Node y no corren en Workers):
  PBKDF2-SHA256 vía WebCrypto.
