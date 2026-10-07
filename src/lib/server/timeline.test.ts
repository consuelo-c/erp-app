import { expect, test } from 'vitest';
import type { Actor, Role } from './actor';
import { filterTimelineForActor } from './timeline';

function userWith(roles: Role[]): Actor {
	return { username: 'test', employeeId: null, roles, kind: 'user' };
}

const orderItems = JSON.stringify([
	{
		product_id: 12,
		name: 'Silla Tiffany',
		qty: 120,
		list_price: 2500,
		unit_price: 2200,
		line_total: 792000
	}
]);

const events = [
	{ id: 1, action: 'CREATED', before: null, after: '{"status":"DRAFT","order_total":900000}' },
	{ id: 2, action: 'EDITED', before: '{"discount":0}', after: '{"discount":50000}' },
	{
		id: 3,
		action: 'STATUS_CHANGED',
		before: '{"status":"CONFIRMED","order_total":850000}',
		after: JSON.stringify({ status: 'PICKED', order_total: 850000, order_items: orderItems })
	},
	{ id: 4, action: 'CANCELLED', before: '{"status":"PICKED"}', after: '{"status":"CANCELLED"}' }
];

test('SALES, MANAGER and ADMIN get every row untouched', () => {
	for (const role of ['SALES', 'MANAGER', 'ADMIN'] as const) {
		expect(filterTimelineForActor(events, userWith([role]))).toEqual(events);
	}
});

test('WAREHOUSE and DRIVER get only status changes', () => {
	for (const role of ['WAREHOUSE', 'DRIVER'] as const) {
		const visible = filterTimelineForActor(events, userWith([role]));
		expect(visible.map((event) => event.id)).toEqual([3, 4]);
	}
});

test('WAREHOUSE and DRIVER get no money fields, not even inside order_items', () => {
	const [statusChange] = filterTimelineForActor(events, userWith(['DRIVER']));
	expect(JSON.parse(statusChange.before ?? '')).toEqual({ status: 'CONFIRMED' });
	const after = JSON.parse(statusChange.after ?? '');
	expect(after.status).toBe('PICKED');
	expect(after).not.toHaveProperty('order_total');
	expect(JSON.parse(after.order_items)).toEqual([
		{ product_id: 12, name: 'Silla Tiffany', qty: 120 }
	]);
});

test('a multi-role WAREHOUSE and SALES user sees everything', () => {
	expect(filterTimelineForActor(events, userWith(['WAREHOUSE', 'SALES']))).toEqual(events);
});

test('rows listed without before/after stay without them', () => {
	const collapsed = [{ id: 3, action: 'STATUS_CHANGED' }];
	expect(filterTimelineForActor(collapsed, userWith(['WAREHOUSE']))).toEqual([
		{ id: 3, action: 'STATUS_CHANGED', before: undefined, after: undefined }
	]);
});
