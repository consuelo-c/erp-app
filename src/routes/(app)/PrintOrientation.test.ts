import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import PrintOrientation from './PrintOrientation.svelte';

test('Vertical leaves the half-letter page unturned', () => {
	const { head, body } = render(PrintOrientation, { props: { isHorizontal: false } });
	expect(head).not.toContain('page-orientation');
	expect(body).toMatch(/<input[^>]*checked[^>]*\/?>Vertical/);
});
