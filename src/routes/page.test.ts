import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import Page from './+page.svelte';

test('root renders the logo', () => {
	expect(render(Page).body).toContain('src="/banquetes-consuelo-c-logo.svg"');
});
