import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import type { ClientCandidate } from '$lib/server/services/contacts';
import ClientSearch from './ClientSearch.svelte';

const WARNING = '⚠ Cliente vetado. Puedes continuar igual.';

const jorge: ClientCandidate = {
	id: 7,
	fullName: 'Jorge Iván Betancur',
	phone: '573007712043',
	whatsapp: null,
	address1: null,
	address2: null,
	isBanned: true
};

function renderSearch(choice: number | 'new' | null, picked: ClientCandidate | null): string {
	const props = { choice, picked, onpick: () => {}, onnew: () => {} };
	return render(ClientSearch, { props }).body;
}

test('a Vetado client picked warns under «Cliente»; another client or «Cliente nuevo» doesn’t', () => {
	expect(renderSearch(jorge.id, jorge)).toContain(WARNING);
	expect(renderSearch(8, { ...jorge, id: 8, isBanned: false })).not.toContain(WARNING);
	expect(renderSearch('new', jorge)).not.toContain(WARNING);
	expect(renderSearch(null, null)).not.toContain(WARNING);
});
