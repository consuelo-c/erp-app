import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import ReachLines from './ReachLines.svelte';

// What the order detail (and the other details and the contacts list) shows under the client's name.
function reach(phone: string | null, whatsapp: string | null): string {
	return render(ReachLines, { props: { phone, whatsapp } }).body;
}

function links(body: string): string[] {
	return [...body.matchAll(/<a [^>]*>/g)].map(([tag]) => {
		const href = tag.match(/href="([^"]+)"/)?.[1];
		const label = tag.match(/aria-label="([^"]+)"/)?.[1];
		return `${label} → ${href}`;
	});
}

test('with both, the phone calls and writes to the number, and the username below writes to it', () => {
	const body = reach('573104428890', 'LuzMarinaR');
	expect(links(body)).toEqual([
		'Llamar al 310 442 8890 → tel:+573104428890',
		'Escribir por WhatsApp al 310 442 8890 → https://wa.me/573104428890',
		'Escribir por WhatsApp a @LuzMarinaR → https://wa.me/LuzMarinaR'
	]);
	expect(body.indexOf('310 442 8890')).toBeLessThan(body.indexOf('@LuzMarinaR'));
	expect(body.match(/reach-lines__line/g)).toHaveLength(2);
});

test('with a phone only, the number and its two icons, no username line', () => {
	const body = reach('573104428890', null);
	expect(links(body)).toEqual([
		'Llamar al 310 442 8890 → tel:+573104428890',
		'Escribir por WhatsApp al 310 442 8890 → https://wa.me/573104428890'
	]);
	expect(body).not.toContain('@');
});

test('with a username only, the username and its WhatsApp icon, no phone line', () => {
	const body = reach(null, 'MayC47');
	expect(links(body)).toEqual(['Escribir por WhatsApp a @MayC47 → https://wa.me/MayC47']);
	expect(body.match(/reach-lines__line/g)).toHaveLength(1);
});

test('with neither, nothing: no line, no icon', () => {
	expect(reach(null, null)).not.toMatch(/reach-lines|<a /);
});
