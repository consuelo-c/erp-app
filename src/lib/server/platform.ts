import { error } from '@sveltejs/kit';

// The Worker's environment: its bindings and secrets. Missing only outside the Worker.
export function getEnv(platform: App.Platform | undefined): Env {
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return platform.env;
}

export function getDb(platform: App.Platform | undefined): D1Database {
	return getEnv(platform).DB;
}
