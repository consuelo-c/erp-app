import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import { DRIVER, WAREHOUSE } from '$lib/server/db/fixture';
import { load } from './+page.server';

// The service prints for every role; Pedidos' route stays closed to the warehouse and the driver,
// who print from Despachos.
test('WAREHOUSE and DRIVER get a 403 on the order printout under /pedidos', async () => {
	for (const user of [WAREHOUSE, DRIVER]) {
		const event = { locals: { user }, params: { id: '1' }, platform: undefined };
		await expect(load(event as never)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	}
});
