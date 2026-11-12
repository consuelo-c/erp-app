# ERP Banquetes Consuelo C

## Requisitos

- Cuenta de Cloudflare
- Cuenta de GitHub
- Node y npm (Puede ser a través de un manejador de versiones como mise o nvm)
- Comando `gh`
- Cuenta de Claude con acceso al _canvas_ del diseño (ver [Diseño](#diseño))

## Cloudflare

### Crear el `API Token`

Necesario para poder hacer despliegues desde GitHub

Acceder _My Profile -> API Tokens -> Create Token -> Create Custom Token_

Agregar el permiso de `Edit` con tipo `Account` a:

- Workers Scripts
- D1
- Workers R2 Storage

> [!CAUTION]
> Hay que copiar el `API Token` ya que no se vuelve a mostrar y lo vamos a necesitar en la configuración de **secretos** de GitHub

### Crear la base de datos D1 y el Bucket R2

```bash
npx wrangler login
npx wrangler whoami # Asegurarse que es la cuenta correcta
```

> [!IMPORTANT]
> Necesitaremos el `Account ID` para la llave `account_id` de `wrangler.jsonc` (el `Account ID` es público, por lo que no es necesario guardarlo como un secreto). Va en ese archivo y no en una variable de ambiente o de GitHub, para que el despliegue no termine en la cuenta equivocada

Crear la base de datos

```bash
npx wrangler d1 create consueloc-erp-db
npx wrangler d1 list --json
```

Y el _bucket_

```bash
npx wrangler r2 bucket create consueloc-erp-arch
npx wrangler r2 bucket list --json
```

> [!TIP]
> `npm run env:create` crea ambos (la base de datos y el bucket) en la cuenta de Cloudflare. El `database_id` que imprime se copia en `wrangler.jsonc`

## Github

Se asume que ya existe el repositorio

### Proteger la rama `main` de GitHub

Acceder _Settings -> Rules -> Rulesets -> New branch ruleset_ y crear una nueva regla con los siguientes parámetros:

- _Enforcement status_: `Active`
- Rama `main`
- _Restrict deletions_ y _Block force pushes_
- _Require a pull request before merging_
- **Pendiente** _Require status checks to pass -> Test_

> [!NOTE]
> La regla pendiente solo se puede crear luego que corra GitHub actions por primera vez

### Crear proyecto en GitHub

Crear el Proyecto **ERP Banquetes Consuelo C** y modificar las columnas y opcionalmente los Workflows

> [!TIP]
> Los proyectos se pueden crear en la terminal también, pero no es posible gestionar los tableros. Por eso se recomienda hacer todo este paso directamente en la Web.
>
> ```bash
> gh project create --owner "consuelo-c" --title "ERP Banquetes Consuelo C"
> gh project list --owner "consuelo-c"
> ```

- Crear columnas de proyecto (campo _Status_: renombrar _In Progress_ a _Doing_ y agregar _Pending_)
  - Todo
  - Doing
  - Pending
  - Done
- Crear vistas de proyecto
  - Tablero -> Kanban y revisar que tenga las columnas _Todo_, _Doing_, _Pending_, _Done_
  - Docs -> Tabla -> filtro `label:docs`
  - Fases -> Tabla -> Agrupada por milestones

> [!NOTE]
> Revisar que existan dos Workflows específicos: Que al crear un issue, este sea agregado a _Todo_ y que al cerrar un issue este sea movido a Done

### Darle a `gh` propiedades para leer y modificar proyectos

```bash
gh auth login
gh auth refresh -s project,read:project
```

### Agregar el `API Token` de Cloudflare como secreto

```bash
gh secret set CLOUDFLARE_API_TOKEN # Ten a mano el token
gh secret list
```

### Depurar las etiquetas de _issues_

Borrar los _labels_ de _Issues_ que no vamos a usar

```bash
gh label delete 'good first issue'
gh label delete 'help wanted'
gh label delete documentation
gh label delete duplicate
gh label delete enhancement
gh label delete invalid
gh label delete question
gh label delete wontfix
```

### Creación de los _labels_ del proyecto

```bash
gh label create bug  --color d73a4a --description "Errores"
gh label create task --color 0075ca --description "Tareas"
gh label create docs --color 5319e7 --description "Hallazgo que va a la próxima versión de los documentos"
gh label create debt --color fbca04 --description "Pendientes o tareas a resolver"
```

> [!TIP]
> `gh issue list --web` abre la lista de tareas en un navegador

### Crear los milestones

```bash
for i in $(seq 0 16); do
  gh api repos/:owner/:repo/milestones -f title="$(printf 'Phase %02d' "$i")" >/dev/null
done
gh api repos/:owner/:repo/milestones --jq '.[].title'
```

> [!NOTE]
> Los milestones pertenecen al repositorio (Issues -> Milestones) mientras que los proyectos pertenecen a la organización (Org -> Projects). Esto es importante a la hora de gestionar el proyecto

## Desplegar en Cloudflare

Esta sección explica cómo poner la aplicación en producción, qué datos necesita para funcionar y cómo asegurarse de que el despliegue quedó bien. Se asume que ya se completaron los pasos de las secciones [Cloudflare](#cloudflare) y [Github](#github), es decir, que ya existen la base de datos, el _bucket_, el `API Token` y el repositorio.

Solo existe un ambiente: no hay _staging_, por lo que la rama `main` es producción. El despliegue no se hace a mano desde la terminal, sino a través del workflow `.github/workflows/deploy.yml` de GitHub Actions. Un `npx wrangler deploy` manual solo tiene sentido para depurar un problema puntual.

### Qué hace el despliegue

Cada vez que corre, el workflow ejecuta estos pasos en orden:

1. Instala las dependencias con `npm ci`.
1. Ejecuta las pruebas. Si alguna falla el proceso se detiene ahí, antes de tocar la base de datos.
1. Compara las migraciones aplicadas en D1 con las de la carpeta `migrations/` y, si dejaron de coincidir, borra la base de datos (ver la advertencia de abajo).
1. Aplica en D1 las migraciones pendientes.
1. Carga los `settings` por defecto desde `scripts/settings-defaults.sql`.
1. Compila la aplicación y la publica con `wrangler deploy`.

> [!WARNING]
> Antes del lanzamiento las migraciones se pueden aplastar. Cuando eso pasa, las migraciones aplicadas en D1 dejan de coincidir con las de `migrations/` y el despliegue reacciona según el contenido de la tabla `orders`:
>
> - Si `orders` está vacía o no existe, **borra todas las tablas de producción** y las crea de nuevo. Esto incluye los usuarios, el catálogo de productos y las secuencias de numeración.
> - Si `orders` tiene filas, el despliegue falla y no borra nada.
>
> Por eso los datos que se cargan a mano deben cargarse después del último despliegue con migraciones aplastadas.

### Variables de ambiente y secretos

La aplicación no necesita un archivo de configuración en producción. Lo que da **acceso** se guarda como secreto, fuera del repositorio, y lo que solo dice **cuál recurso** usar vive en `wrangler.jsonc`, porque sin credenciales no sirve de nada.

| Nombre                 | Para qué sirve                                                             | Dónde vive                 | Cómo se define                                      |
| ---------------------- | -------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN` | Le permite a GitHub Actions desplegar en Cloudflare                        | GitHub Secrets             | `gh secret set CLOUDFLARE_API_TOKEN`                |
| `ADMIN_PASSWORD`       | Contraseña con la que el Worker crea el login `admin`                      | Secreto del Worker         | `npx wrangler secret put ADMIN_PASSWORD`            |
| `PASSWORD_PEPPER`      | Valor aleatorio que se mezcla con el _hash_ de todas las contraseñas       | Secreto del Worker         | `npx wrangler secret put PASSWORD_PEPPER`           |
| `TURNSTILE_SECRET_KEY` | Valida en el servidor el _widget_ de Turnstile de la consulta de pedidos   | Secreto del Worker         | `npx wrangler secret put TURNSTILE_SECRET_KEY`      |
| `TURNSTILE_SITE_KEY`   | Muestra el _widget_ de Turnstile en la página pública. Es un valor público | `vars` en `wrangler.jsonc` | Se copia del _widget_ en el dashboard de Cloudflare |
| `account_id`           | Indica en qué cuenta de Cloudflare se despliega                            | `wrangler.jsonc`           | Se copia de `npx wrangler whoami`                   |
| `database_id`          | Indica cuál base de datos D1 usa el Worker                                 | `wrangler.jsonc`           | Se copia de `npx wrangler d1 info consueloc-erp-db` |

Los _bindings_ `DB` (D1), `BUCKET` (R2) y `LOOKUP_RATE_LIMIT` (el límite de consultas de la página pública) ya están declarados en `wrangler.jsonc`, así que no hay que configurarlos en ningún otro lugar.

> [!NOTE]
> En desarrollo los tres secretos del Worker van en el archivo `.dev.vars`, que no entra al repositorio. El archivo `.env.example` lista los nombres. Allí se usa un `PASSWORD_PEPPER` distinto al de producción y la clave secreta de prueba de Turnstile.

> [!TIP]
> Si se modifica `wrangler.jsonc` hay que ejecutar `npx wrangler types` para regenerar los tipos.

### Datos iniciales

Una instalación nueva arranca sin información de negocio. Algunos datos llegan solos con el despliegue y otros hay que cargarlos a mano.

Llegan automáticamente:

- **Configuración por defecto:** cada despliegue aplica `scripts/settings-defaults.sql`, que trae los datos de la empresa, los parámetros de nómina, los festivos y el primer borrador de la ayuda. Solo agrega las llaves que falten, así que nunca sobrescribe un valor editado en la aplicación.
- **El login `admin`:** no viene en ningún _seed_. El Worker lo crea con el valor de `ADMIN_PASSWORD` en el primer intento de inicio de sesión. De esta forma el `PASSWORD_PEPPER` de producción nunca sale de Cloudflare.

Se cargan a mano:

- **WhatsApp y términos y condiciones:** `COMPANY_WHATSAPP` y `TERMS_CONDITIONS` llegan vacíos y se llenan desde _Configuración_ en la aplicación.
- **Catálogo de productos:** siguiendo la sección [Importar el catálogo desde WooCommerce](#importar-el-catálogo-desde-woocommerce).
- **Numeración de los pedidos:** siguiendo la sección [Fijar la secuencia de los pedidos](#fijar-la-secuencia-de-los-pedidos).
- **Numeración de las cuentas de cobro:** siguiendo la sección [Fijar la secuencia de las cuentas de cobro](#fijar-la-secuencia-de-las-cuentas-de-cobro).

> [!CAUTION]
> El archivo `scripts/sample-data.sql`, que se carga con `npm run db:seed`, tiene datos de ejemplo y es solo para desarrollo. Nunca se debe ejecutar en producción.

### Paso 1: Confirmar la cuenta y los recursos

Antes de desplegar hay que asegurarse de estar trabajando en la cuenta correcta. Esto es importante cuando se manejan varias cuentas de Cloudflare, porque el error es silencioso: el despliegue puede fallar con un mensaje que parece un problema de permisos o, peor aún, funcionar en la cuenta equivocada.

```bash
npx wrangler whoami
npx wrangler d1 info consueloc-erp-db
npx wrangler r2 bucket list
gh secret list --repo consuelo-c/erp-app
```

Con la salida de esos comandos se revisa que:

- El `Account ID` de la cuenta sea igual al `account_id` de `wrangler.jsonc`
- El ID de la base de datos sea igual al `database_id` de `wrangler.jsonc`
- Aparezca el _bucket_ `consueloc-erp-arch`
- Aparezca el secreto `CLOUDFLARE_API_TOKEN`

### Paso 2: Ejecutar el despliegue

El workflow se puede ejecutar de dos formas: automáticamente al hacer _merge_ a `main` o manualmente con `gh workflow run`. Ninguna de las dos funciona mientras el workflow esté deshabilitado, y ese es su estado actual, así que primero hay que revisarlo y habilitarlo.

```bash
gh workflow list --all --repo consuelo-c/erp-app
gh workflow enable deploy.yml --repo consuelo-c/erp-app
```

El primer comando muestra `active` si el workflow está habilitado y `disabled_manually` si no lo está. Una vez habilitado se lanza el despliegue y se sigue su avance en la terminal. Si `gh run watch` pregunta cuál ejecución seguir, se elige la de _Deploy_.

```bash
gh workflow run deploy.yml --ref main --repo consuelo-c/erp-app
gh run watch --exit-status --repo consuelo-c/erp-app
```

> [!IMPORTANT]
> Mientras el workflow esté habilitado **cada _merge_ a `main` despliega a producción**. Si se prefiere desplegar solo a propósito, hay que deshabilitarlo de nuevo al terminar:
>
> ```bash
> gh workflow disable deploy.yml --repo consuelo-c/erp-app
> ```

### Paso 3: Crear los secretos del Worker

Los secretos se guardan en el Worker y se conservan entre despliegues, así que este paso solo se hace la primera vez. Sin ellos la página pública carga, pero nadie puede iniciar sesión ni consultar un pedido.

Primero se revisa cuáles existen, para crear únicamente los que falten:

```bash
npx wrangler secret list
```

Luego se crean los que no aparezcan en la lista. `wrangler` pide la contraseña en la terminal, mientras que el _pepper_ se genera con `openssl`:

```bash
npx wrangler secret put ADMIN_PASSWORD
openssl rand -base64 32 | npx wrangler secret put PASSWORD_PEPPER
```

`TURNSTILE_SECRET_KEY` se crea en el paso siguiente, porque su valor lo entrega el _widget_ de Turnstile.

> [!CAUTION]
> Si `PASSWORD_PEPPER` ya aparece en la lista **no se debe volver a generar**. Reemplazarlo hace que todas las contraseñas dejen de funcionar. Ver [Creando la contraseña de `admin`](#creando-la-contraseña-de-admin).

### Paso 4: Configurar el dashboard de Cloudflare

Hay tres cosas que no viven en el repositorio y se configuran una sola vez desde el dashboard. El dominio debe agregarse después del primer despliegue, porque antes no existe un Worker al cual apuntar.

**El dominio de la aplicación.** Acceder _Workers & Pages -> `consueloc-erp` -> Settings -> Domains & Routes -> Add -> Custom domain_ y agregar `app.consueloc.com`. Cloudflare crea el registro DNS y emite el certificado por su cuenta, lo cual puede tardar unos minutos.

**El límite de intentos de inicio de sesión.** Este límite no está en el código. Acceder _`consueloc.com` -> Security -> WAF -> Rate limiting rules_ y crear una regla que cubra las peticiones `POST` a `app.consueloc.com/login`. El plan gratuito incluye una regla.

**El _widget_ de Turnstile.** Protege la consulta de pedidos de la página pública. Acceder _Turnstile -> Add widget_ y crearlo con estos parámetros:

- Nombre: `consueloc-erp-lookup`
- Hostname: `app.consueloc.com`
- Modo: _Managed_, sin _pre-clearance_

El _widget_ entrega dos llaves: la _secret key_ se guarda con `npx wrangler secret put TURNSTILE_SECRET_KEY`, y la _site key_ se copia en `vars.TURNSTILE_SITE_KEY` de `wrangler.jsonc`. Como ese archivo hace parte del repositorio, cambiar la _site key_ requiere un nuevo despliegue.

### Paso 5: Cargar los datos iniciales

Por último se cargan los datos que se hacen a mano, descritos en [Datos iniciales](#datos-iniciales). Como se explicó en la advertencia de [Qué hace el despliegue](#qué-hace-el-despliegue), esto debe hacerse después del último despliegue con migraciones aplastadas, ya que de lo contrario esos datos se pierden.

### Verificar el despliegue

Para estar seguros de que todo quedó bien, primero se revisa desde la terminal que el despliegue terminó y que el Worker y la base de datos están como se espera.

El último despliegue debe aparecer con estado `success`, y la versión más reciente del Worker debe corresponder a ese despliegue:

```bash
gh run list --workflow deploy.yml --limit 1 --repo consuelo-c/erp-app
npx wrangler deployments list
```

Deben aparecer los tres secretos: `ADMIN_PASSWORD`, `PASSWORD_PEPPER` y `TURNSTILE_SECRET_KEY`:

```bash
npx wrangler secret list
```

No debe quedar ninguna migración pendiente:

```bash
npx wrangler d1 migrations list consueloc-erp-db --remote
```

La tabla `settings` debe tener filas:

```bash
npx wrangler d1 execute consueloc-erp-db --remote --command "SELECT count(*) AS total FROM settings"
```

Esta consulta lista los datos de la empresa que siguen vacíos. Antes del lanzamiento no debe devolver filas:

```bash
npx wrangler d1 execute consueloc-erp-db --remote --command "SELECT key FROM settings WHERE key IN ('COMPANY_WHATSAPP', 'TERMS_CONDITIONS') AND value = ''"
```

El dominio debe responder con estado `200`:

```bash
curl -sI https://app.consueloc.com | head -n 1
```

Después se hace una revisión en el navegador. Debe hacerse en `https://app.consueloc.com` y no en la URL de `workers.dev`, porque el _widget_ de Turnstile solo está autorizado para ese dominio.

- [ ] La página `/` carga y muestra el _widget_ de Turnstile
- [ ] Una consulta con cualquier teléfono y fecha responde «No encontramos un pedido con ese teléfono y esa fecha.». Si en cambio responde «No pudimos verificar la consulta. Intente de nuevo.», hay que revisar `TURNSTILE_SECRET_KEY` y el _widget_
- [ ] La página `/login` permite entrar con el usuario `admin` y la contraseña guardada en `ADMIN_PASSWORD`
- [ ] _Productos_ muestra el catálogo importado
- [ ] _Configuración_ muestra los datos de la empresa

> [!WARNING]
> No se deben crear pedidos de prueba en producción. Un pedido consume un número de la secuencia de `orders`, y una vez que `orders` tiene filas el despliegue ya no puede borrar la base de datos después de aplastar las migraciones.

## Diseño

El diseño vive fuera de este repositorio, en tres lugares. Los términos están en el [glosario](https://github.com/consuelo-c/erp-planning/blob/main/GLOSSARY.md).

| Dónde                                                                                                      | Qué tiene                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| La marca, en [`consuelo-c/branding`](https://github.com/consuelo-c/branding)                               | El logo, los colores, la fuente, los radios, la voz y los mensajes de la empresa                                                  |
| El Design System, en [`erp-planning:design/`](https://github.com/consuelo-c/erp-planning/tree/main/design) | Los _tokens_ y componentes propios de la app, lo que comparten todas las pantallas y los datos de ejemplo                         |
| El _canvas_, [Consuelo C ERP Canvas](https://claude.ai/artifact/TBE5f1FaBxQJxkKwncJspg)                    | Las pantallas y los impresos: una página por sección (`project/08 Despachos, Recogidas y Transiciones.dc.html`), con sus _frames_ |

El _canvas_ es un _artifact_ privado: lo ve la cuenta de Claude que lo creó y las personas con quienes se comparta desde el mismo _artifact_.

### Desde el navegador

Se abre el enlace con la sesión de Claude iniciada. En el _canvas_ se diseñan las pantallas: se abre en su editor, en Claude, y se pide el cambio en el chat, por ejemplo con el _prompt_ que escribe Claude Code al abrir una fase. La galería de _artifacts_ está en <https://claude.ai/code/artifacts>.

### Desde Claude Code

Claude Code lo lee con la herramienta `Artifact`, con la misma cuenta de Claude con la que se inició sesión en `claude`. No hace falta exportar nada ni abrir un navegador:

- El _canvas_ se lee por rutas: primero la lista de páginas, `project/compat.json`, y luego solo las páginas de las pantallas que nombra el _issue_.
- Claude Code publica en él solo cuando una página tiene que coincidir con el código, y avisa cada vez. Nada se escribe hasta que el desarrollador aprueba el aviso de publicación.
- El Design System no es un _artifact_: Claude Code lo edita en `erp-planning:design/` cuando el código lo requiere.

> [!TIP]
> En la terminal de `claude`, el comando `/artifacts` lista los _artifacts_ de la cuenta: la tecla `o` abre uno en el navegador y la `c` copia su enlace.

Las copias viejas de Claude Design (`claude.ai/design/p/…`) quedaron de solo lectura y conservan los chats y comentarios de antes del traslado. Claude Design independiente cierra el 14 de diciembre de 2026.

## Flujo de trabajo con _issues_

Las ramas se nombran `<tipo>/<issue>-<slug>`: el tipo es `feat`, `fix`, `chore` o `docs` (los mismos de los commits), luego el número del _issue_ y luego qué hace, en minúsculas con guiones. Por ejemplo `feat/12-timesheets-table`.

Crear la rama desde el _issue_ para que quede vinculada a él (sección _Development_ del _issue_):

```bash
gh issue develop 14 --name chore/14-brand-readme-markdownlint --checkout # Crea la rama en GitHub desde main, la vincula y cambia a ella
# Cuando se termine el trabajo...
git add README.md .markdownlint.json static/
git commit -m "chore: add brand files, README and markdownlint config"
git push
gh pr create --fill --body "Closes #14" # El PR cierra el issue al hacer merge
gh pr merge <N> --squash --delete-branch   # O hacer merge en la web de GH
git checkout main && git pull
```

Al hacer _merge_ del PR a `main`, el _issue_ se cierra (y el Workflow del proyecto lo mueve a _Done_).

> [!TIP]
> `gh issue develop 12 --list` muestra las ramas vinculadas a un _issue_
> `gh pr list` Muestra los PRs que están abiertos

## Creando la contraseña de `admin`

En ambiente local `npm run dev` buscará estos datos en las variables de ambiente o en el archivo `.dev.vars`.

```bash
echo "ADMIN_PASSWORD=..." >> .dev.vars
echo "PASSWORD_PEPPER=$(openssl rand -base64 32)" >> .dev.vars
```

En Cloudflare la contraseña es un _secret_, al igual que `PASSWORD_PEPPER` por lo que debemos usar `wrangler`

```bash
npx wrangler secret put ADMIN_PASSWORD
openssl rand -base64 32 | npx wrangler secret put PASSWORD_PEPPER
```

> [!CAUTION]
> Si se cambia el `PASSWORD_PEPPER` en producción todos los usuarios perderán acceso. Por eso podría ser buena idea guardar la salida de `openssl` en Bitwarden

> [!IMPORTANT]
> `ADMIN_PASSWORD` solo se lee mientras no exista el login `admin`, es decir, hasta el primer intento de inicio de sesión. Después, cambiar el _secret_ no cambia la contraseña: se cambia en la aplicación, en _Logins → `admin` → Cambiar contraseña_.

## Importar el catálogo desde WooCommerce

Se creó un script que toma el CSV de WooCommerce y lo convierte en un archivo `.sql` que luego puede importarse en D1 usando `wrangler`. Para exportar, en WordPress, _Productos → Exportar_ (todas las columnas) genera un CSV. Luego en la terminal se importa:

```bash
node scripts/convert-wc-catalog.js ~/Downloads/wc-product-export-….csv products-import.sql
npx wrangler d1 execute consueloc-erp-db --local --file products-import.sql   # Desarrollo
npx wrangler d1 execute consueloc-erp-db --remote --file products-import.sql  # Producción
```

- Solo entran los productos simples que tienen precio y categoría de alquiler. Las variaciones, el Catering, los productos sin precio y los nombres repetidos se omiten, y el script los lista.
- Los productos no publicados entran inactivos. Todos entran con 0 unidades, que se completan en _Productos_.
- Se puede ejecutar varias veces: un producto cuyo nombre ya existe (sin importar mayúsculas) se omite.

## Fijar la secuencia de los pedidos

Para que el primer pedido que cree la aplicación siga la numeración en papel, la secuencia de `orders` se fija una sola vez en producción con el último número en papel.

Se hace antes del primer pedido real y después del último despliegue con migraciones aplastadas: mientras `orders` esté vacía, ese despliegue borra la base de datos y con ella la secuencia.

> [!NOTE]
> Reemplazar `NNNN` por el último número en papel:

```bash
npx wrangler d1 execute consueloc-erp-db --remote --command "SELECT seq FROM sqlite_sequence WHERE name = 'orders'"
npx wrangler d1 execute consueloc-erp-db --remote --command "INSERT INTO sqlite_sequence (name, seq) VALUES ('orders', NNNN)"
npx wrangler d1 execute consueloc-erp-db --remote --command "SELECT seq FROM sqlite_sequence WHERE name = 'orders'"
```

> [!WARNING]
> El primer `SELECT` no debe devolver filas. Si devuelve una, ya se creó un pedido y no se debe ejecutar el `INSERT`. El último `SELECT` debe devolver `NNNN`.

## Fijar la secuencia de las cuentas de cobro

Para que la primera cuenta de cobro que emita la aplicación siga la numeración en papel, la secuencia de `receivables` se fija una sola vez en producción con el último número en papel.

Se hace después del lanzamiento y antes de emitir la primera cuenta de cobro

> [!NOTE]
> Reemplazar `NNNN` por el último número en papel:

```bash
npx wrangler d1 execute consueloc-erp-db --remote --command "SELECT seq FROM sqlite_sequence WHERE name = 'receivables'"
npx wrangler d1 execute consueloc-erp-db --remote --command "INSERT INTO sqlite_sequence (name, seq) VALUES ('receivables', NNNN)"
npx wrangler d1 execute consueloc-erp-db --remote --command "SELECT seq FROM sqlite_sequence WHERE name = 'receivables'"
```

> [!WARNING]
> El primer `SELECT` no debe devolver filas. Si devuelve una, ya se emitió una cuenta de cobro y no se debe ejecutar el `INSERT`. El último `SELECT` debe devolver `NNNN`.

<!-- vim: spelllang=es
n,
-->
