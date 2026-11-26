import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import { createMemoryD1 } from './db/memory-d1';
import { getDb, getEnv } from './platform';

const thrownBy = (read: () => unknown) => {
	try {
		read();
	} catch (thrown) {
		return thrown;
	}
	return undefined;
};

test('without the platform, getEnv and getDb answer the same 500', () => {
	for (const read of [() => getEnv(undefined), () => getDb(undefined)]) {
		const thrown = thrownBy(read);
		expect(isHttpError(thrown, 500)).toBe(true);
		expect(thrown).toMatchObject({ body: { message: 'Sin acceso a la base de datos' } });
	}
});

test("getEnv hands over the Worker's environment, getDb its database", () => {
	const env = { DB: createMemoryD1().db, PASSWORD_PEPPER: 'pepper' } as unknown as Env;
	const platform = { env } as App.Platform;
	expect(getEnv(platform)).toBe(env);
	expect(getDb(platform)).toBe(env.DB);
});
