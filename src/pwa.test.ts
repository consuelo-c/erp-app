import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const manifest = JSON.parse(readFileSync('static/manifest.json', 'utf8'));

test('manifest declares name and theme color', () => {
	expect(manifest.name).toBe('Banquetes Consuelo C');
	expect(manifest.theme_color).toBe('#333333');
});

test('each manifest icon is declared once as any and once as maskable, and exists in static/', () => {
	for (const path of ['/icon-192.png', '/icon-512.png']) {
		const purposes = manifest.icons
			.filter((icon: { src: string }) => path === icon.src)
			.map((icon: { purpose: string }) => icon.purpose);
		expect(purposes.sort()).toEqual(['any', 'maskable']);
		expect(existsSync(`static${path}`)).toBe(true);
	}
	expect(manifest.icons).toHaveLength(4);
});

test('logo inherits its color instead of hard-coding black', () => {
	const logo = readFileSync('static/banquetes-consuelo-c-logo.svg', 'utf8');
	expect(logo).not.toContain('fill="black"');
	expect(logo).toContain('fill="currentColor"');
});
