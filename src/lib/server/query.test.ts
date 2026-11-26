import { expect, test } from 'vitest';
import { paginate } from './query';

test('zero rows is page 1 of 1, at offset 0', () => {
	expect(paginate(0, 1, 20)).toEqual({ page: 1, pageCount: 1, offset: 0 });
});

test('a page past the last is the last', () => {
	expect(paginate(45, 7, 20)).toEqual({ page: 3, pageCount: 3, offset: 40 });
});

test('a middle page starts after the pages before it', () => {
	expect(paginate(45, 2, 20)).toEqual({ page: 2, pageCount: 3, offset: 20 });
});
