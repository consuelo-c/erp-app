import { expect, test } from 'vitest';
import { renderHelp, renderTerms } from './markdown';

function introOf(text: string): string {
	return renderHelp(text).intro;
}

test('raw HTML comes out escaped, shown as typed', () => {
	expect(introOf('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
	expect(introOf('Foto <img src=x onerror=alert(1)> aquí')).toBe(
		'<p>Foto &lt;img src=x onerror=alert(1)&gt; aquí</p>\n'
	);
	expect(introOf('<b>x</b>')).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>\n');
});

test.each([
	[
		'http://example.com',
		'<a href="http://example.com" target="_blank" rel="noopener noreferrer">x</a>'
	],
	[
		'https://example.com',
		'<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>'
	],
	['mailto:info@example.com', '<a href="mailto:info@example.com">x</a>'],
	['tel:+573104428890', '<a href="tel:+573104428890">x</a>'],
	['/despachos', '<a href="/despachos">x</a>']
])('a %s link is kept', (href, link) => {
	expect(introOf(`[x](${href})`)).toBe(`<p>${link}</p>\n`);
});

test.each([
	'javascript:alert(1)',
	'JavaScript:alert(1)',
	'data:text/html,hola',
	'DATA:text/html,hola',
	'vbscript:msgbox(1)',
	'VBScript:msgbox(1)',
	'<  javascript:alert(1)>',
	'<\tjavascript:alert(1)>'
])('a %s link renders as its text, with no href', (href) => {
	expect(introOf(`[*texto*](${href})`)).toBe('<p><em>texto</em></p>\n');
});

test('an entity in a link stays escaped, never read as a scheme', () => {
	expect(introOf('[x](&#106;avascript:alert(1))')).not.toMatch(/href="j/i);
});

test('an https: image renders lazily, without referrer, with its alt', () => {
	expect(introOf('![Mesa redonda](https://example.com/mesa.jpg)')).toBe(
		'<p><img src="https://example.com/mesa.jpg" alt="Mesa redonda" loading="lazy" referrerpolicy="no-referrer"></p>\n'
	);
});

test.each([
	'http://example.com/mesa.jpg',
	'/mesa.jpg',
	'data:image/png;base64,AAAA',
	'javascript:alert(1)'
])('an image at %s renders its alt text and no <img>', (source) => {
	expect(introOf(`![Mesa "redonda"](${source})`)).toBe('<p>Mesa &quot;redonda&quot;</p>\n');
});

test('bold, italics, lists, a quote and a table render', () => {
	const html = introOf(
		'**negrita** y *cursiva*\n\n- uno\n- dos\n\n1. primero\n2. segundo\n\n> cita\n\n| A | B |\n| - | - |\n| 1 | 2 |'
	);
	expect(html).toContain('<strong>negrita</strong>');
	expect(html).toContain('<em>cursiva</em>');
	expect(html).toContain('<ul>\n<li>uno</li>');
	expect(html).toContain('<ol>\n<li>primero</li>');
	expect(html).toContain('<blockquote>\n<p>cita</p>');
	expect(html).toContain('<table>');
});

test('with no ## heading, the whole text is the intro', () => {
	expect(renderHelp('Bienvenido.\n\n### Detalle\n\nTexto.')).toEqual({
		intro: '<p>Bienvenido.</p>\n<h3>Detalle</h3>\n<p>Texto.</p>\n',
		questions: []
	});
});

test('each ## starts a question holding everything up to the next, its ### included', () => {
	const help = renderHelp(
		'Bienvenido.\n\n## ¿Cuándo paga el cliente?\n\nAl confirmar.\n\n### Saldo\n\nNo bloquea.\n\n## Otra *pregunta*\n\nFin.'
	);
	expect(help).toEqual({
		intro: '<p>Bienvenido.</p>\n',
		questions: [
			{
				id: 'cuando-paga-el-cliente',
				heading: '¿Cuándo paga el cliente?',
				body: '<p>Al confirmar.</p>\n<h3>Saldo</h3>\n<p>No bloquea.</p>\n'
			},
			{ id: 'otra-pregunta', heading: 'Otra <em>pregunta</em>', body: '<p>Fin.</p>\n' }
		]
	});
});

test('a text starting with ## has an empty intro', () => {
	expect(renderHelp('## Hola\n\nTexto.').intro).toBe('');
});

test('the same heading again gets -2, then -3', () => {
	const ids = renderHelp('## Pagos\n\na\n\n## pagos\n\nb\n\n## PAGOS\n\nc').questions.map(
		({ id }) => id
	);
	expect(ids).toEqual(['pagos', 'pagos-2', 'pagos-3']);
});

test('a reference link defined in another section still resolves', () => {
	const help = renderHelp('Ver [la guía][guia].\n\n## Pregunta\n\n[guia]: https://example.com');
	expect(help.intro).toContain('href="https://example.com"');
});

test('the terms render whole: ## a plain heading, raw HTML escaped, links filtered', () => {
	expect(renderTerms('Intro\n\n## Depósito\n\n<b>x</b> [y](javascript:alert(1))')).toBe(
		'<p>Intro</p>\n<h2>Depósito</h2>\n<p>&lt;b&gt;x&lt;/b&gt; y</p>\n'
	);
	expect(renderTerms('')).toBe('');
});
