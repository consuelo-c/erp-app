import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const manifest = JSON.parse(readFileSync('static/manifest.json', 'utf8'));

test('manifest declares name and theme color', () => {
	expect(manifest.name).toBe('Banquetes Consuelo C');
	expect(manifest.theme_color).toBe('#333333');
});

test('manifest icons are maskable and exist in static/', () => {
	expect(manifest.icons).toHaveLength(2);
	for (const icon of manifest.icons) {
		expect(icon.purpose).toBe('any maskable');
		expect(existsSync(`static${icon.src}`)).toBe(true);
	}
});

test('logo inherits its color instead of hard-coding black', () => {
	const logo = readFileSync('static/banquetes-consuelo-c-logo.svg', 'utf8');
	expect(logo).not.toContain('fill="black"');
	expect(logo).toContain('fill="currentColor"');
});
