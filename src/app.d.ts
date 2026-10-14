// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		// interface Error {}
		interface Locals {
			// Null without a valid session; set by hooks.server.ts.
			user: import('$lib/server/actor').Actor | null;
		}
		// interface PageData {}
		// interface PageState {}
	}

	// A Workers extension, missing under `vite dev` (Node). The DOM types SvelteKit loads shadow the
	// Workers declaration of SubtleCrypto.
	interface SubtleCrypto {
		timingSafeEqual?(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
	}
}

export {};
