# Aplicación de gestión para Banquetes Consuelo C

Aplicación para la gestión de Nomina, Pedidos, Despachos e Inventario para [Banquetes Consuelo C](https://consueloc.com)

## Recrear este proyecto

## Desarrollo

Si desea recrear este proyecto, este es el comando que se debe ejecutar:

```sh
# recreate this project
npx sv@0.17.0 create --template minimal --types ts --add sveltekit-adapter="adapter:cloudflare+cfTarget:workers" drizzle="database:d1" vitest="usages:unit" --no-download-check --install npm .
npm install
```

Para crear iniciar el servidor de desarrollo:

```sh
npm run dev -- --open # Open para abrir el navegador automaticamente
```

Para crear una version que se pueda desplegar en algun servidor web:Para crear una version que se pueda desplegar en algun servidor web:Para crear una version que se pueda desplegar en algun servidor web:Para crear una version que se pueda desplegar en algun servidor web:

```sh
npm run build
npm run preview
```
