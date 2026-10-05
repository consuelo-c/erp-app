# ERP Banquetes Consuelo C

## Requisitos

- Cuenta de Cloudflare
- Cuenta de GitHub
- Cuenta de Mailgun
- Node y npm (Puede ser a través de un manejador de versiones como mise o nvm)
- Comando `gh`

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
> Necesitaremos el `Account ID` para la configuración de _GitHub Variables_ (no secretos)

Crear la base de datos

```bash
npx wrangler d1 create consueloc-erp-db
npx wrangler d1 list --json
```

```bash
npx wrangler r2 bucket create consueloc-erp-arch
npx wrangler r2 bucket list --json
```

> [!TIP]
> `npm run env:create` crea ambos (la base de datos y el bucket). El `database_id` que imprime se copia en `wrangler.jsonc`

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

### Agregar el `Account ID` de Cloudflare como variable

```bash
gh variable set CLOUDFLARE_ACCOUNT_ID  # Preguntará por el valor de la variable
gh variable list
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
for i in $(seq 0 12); do
  gh api repos/:owner/:repo/milestones -f title="$(printf 'Phase %02d' "$i")" >/dev/null
done
gh api repos/:owner/:repo/milestones --jq '.[].title'
```

> [!NOTE]
> Los milestones pertenecen al repositorio (Issues -> Milestones) mientras que los proyectos pertenecen a la organización (Org -> Projects). Esto es importante a la hora de gestionar el proyecto

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
> `gh pr list` Muestra los PRs que están abiertos en

<!-- vim: spelllang=es
-->
