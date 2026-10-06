/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `shell-${version}`;
const SHELL_PAGE = '/';
// Cache-first is safe: every deploy has a new `version`, so a new cache replaces these copies.
const STATIC_ASSETS = new Set([...build, ...files]);

async function cacheShell() {
	const cache = await caches.open(CACHE_NAME);
	await cache.addAll([...STATIC_ASSETS, SHELL_PAGE]);
}

async function deleteOldCaches() {
	const cacheNames = await caches.keys();
	const oldCacheNames = cacheNames.filter((name) => CACHE_NAME !== name);
	await Promise.all(oldCacheNames.map((name) => caches.delete(name)));
}

async function fromCacheOrNetwork(request: Request) {
	const cached = await caches.match(request);
	return cached ?? fetch(request);
}

// Offline, any navigation falls back to the cached shell instead of the browser's error page.
async function fromNetworkOrShell(request: Request) {
	try {
		return await fetch(request);
	} catch (error) {
		const shell = await caches.match(SHELL_PAGE);
		if (!shell) {
			throw error;
		}
		return shell;
	}
}

sw.addEventListener('install', (event) => {
	event.waitUntil(cacheShell());
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(deleteOldCaches());
});

// Only the shell is served from the cache: API and data requests always go to the network.
sw.addEventListener('fetch', (event) => {
	if ('GET' !== event.request.method) {
		return;
	}
	const { pathname } = new URL(event.request.url);
	if (STATIC_ASSETS.has(pathname)) {
		event.respondWith(fromCacheOrNetwork(event.request));
		return;
	}
	if ('navigate' === event.request.mode) {
		event.respondWith(fromNetworkOrShell(event.request));
	}
});
