import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import Page from './+page.svelte';

test('the landing shows the logo and an icon link to /login named Empleados', () => {
	const { body } = render(Page);
	expect(body).toContain('src="/banquetes-consuelo-c-logo.svg"');
	expect(body).toMatch(/<a[^>]*href="\/login"[^>]*aria-label="Empleados"/);
	expect(body).toContain('#login');
});
