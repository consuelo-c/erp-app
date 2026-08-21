// Prerenderizada para que el service worker tenga un shell HTML que cachear:
// sin esto, sin red el navegador no puede cargar nada y no hay app que mostrar.
export const prerender = true;
