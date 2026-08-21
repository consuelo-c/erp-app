/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// `version` cambia en cada build, así que cada despliegue estrena caché y el
// `activate` borra las anteriores. No hay caché que envejezca sin que nadie note.
const CACHE = `shell-${version}`;

/** El shell: el JS y CSS del build, lo de static/ y las páginas prerenderizadas. */
const SHELL = [...build, ...files, ...prerendered];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(SHELL))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method !== 'GET' || url.origin !== sw.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// El shell se sirve del caché: es inmutable dentro de una versión.
			if (SHELL.includes(url.pathname)) {
				const hit = await cache.match(url.pathname);
				if (hit) return hit;
			}

			// Todo lo demás va a la red. Si no hay señal y resulta que estaba en
			// caché, se sirve; si no, falla como fallaría sin service worker.
			try {
				return await fetch(event.request);
			} catch (err) {
				const hit = await cache.match(event.request);
				if (hit) return hit;
				throw err;
			}
		})()
	);
});
