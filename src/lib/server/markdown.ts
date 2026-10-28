// The help's Markdown to HTML: the only output that reaches `{@html}`. The text is written by
// `MANAGER`, not only `ADMIN`, and read with every role's session, so it's a trust boundary.

import { Marked, type Token, type Tokens, type TokensList } from 'marked';
import { fold } from '$lib/format';

export type HelpQuestion = { id: string; heading: string; body: string };
export type RenderedHelp = { intro: string; questions: HelpQuestion[] };

const LINK_SCHEMES = /^(https?|mailto|tel):/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

// Browsers drop spaces, tabs and control characters from a URL before reading its scheme.
function readScheme(href: string): string {
	return href.replaceAll(/[\s\p{Cc}]/gu, '');
}

function isSafeLink(href: string): boolean {
	const url = readScheme(href);
	return LINK_SCHEMES.test(url) || !ANY_SCHEME.test(url);
}

function titleAttribute(title: string | null | undefined): string {
	return title ? ` title="${escapeHtml(title)}"` : '';
}

const markdown = new Marked({
	renderer: {
		html({ text }) {
			return escapeHtml(text);
		},
		link({ href, title, tokens }) {
			const text = this.parser.parseInline(tokens);
			if (!isSafeLink(href)) {
				return text;
			}
			const target = /^https?:/i.test(readScheme(href))
				? ' target="_blank" rel="noopener noreferrer"'
				: '';
			return `<a href="${escapeHtml(href)}"${titleAttribute(title)}${target}>${text}</a>`;
		},
		image({ href, title, text }) {
			if (!/^https:/i.test(readScheme(href))) {
				return escapeHtml(text);
			}
			return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttribute(title)} loading="lazy" referrerpolicy="no-referrer">`;
		}
	}
});

/** A heading's anchor: accents and case folded, words joined by hyphens, `-2`, `-3` when repeated. */
function makeQuestionId(heading: string, usedIds: Map<string, number>): string {
	const base =
		fold(heading)
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'pregunta';
	const count = (usedIds.get(base) ?? 0) + 1;
	usedIds.set(base, count);
	return 1 === count ? base : `${base}-${count}`;
}

function isQuestionHeading(token: Token): token is Tokens.Heading {
	return 'heading' === token.type && 2 === token.depth;
}

function renderTokens(tokens: Token[], links: TokensList['links']): string {
	return markdown.parser(Object.assign(tokens, { links }));
}

/** The help text as its intro, everything before the first `##`, and one question per `##`. */
export function renderHelp(text: string): RenderedHelp {
	const tokens = markdown.lexer(text);
	const usedIds = new Map<string, number>();
	const intro: Token[] = [];
	const questions: { heading: Tokens.Heading; body: Token[] }[] = [];
	for (const token of tokens) {
		if (isQuestionHeading(token)) {
			questions.push({ heading: token, body: [] });
		} else {
			(questions.at(-1)?.body ?? intro).push(token);
		}
	}
	return {
		intro: renderTokens(intro, tokens.links),
		questions: questions.map(({ heading, body }) => ({
			id: makeQuestionId(heading.text, usedIds),
			heading: markdown.parseInline(heading.text) as string,
			body: renderTokens(body, tokens.links)
		}))
	};
}
