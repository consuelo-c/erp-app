import { expect, test } from 'vitest';
import { resolveMigrationDrift } from './wipe-d1-if-squashed.js';

const files = ['0000_init.sql', '0001_orders.sql'];

test('no drift while the applied migrations are a prefix of migrations/', () => {
	expect(resolveMigrationDrift([], files, 0)).toBe('none');
	expect(resolveMigrationDrift(['0000_init.sql'], files, 0)).toBe('none');
	expect(resolveMigrationDrift(files, files, 5)).toBe('none');
});

test('wipes after a squash when orders is missing or empty', () => {
	expect(resolveMigrationDrift(['0000_skeleton.sql'], files, 0)).toBe('wipe');
	expect(resolveMigrationDrift([...files, '0002_gone.sql'], files, 0)).toBe('wipe');
});

test('refuses after a squash when orders has rows', () => {
	expect(resolveMigrationDrift(['0000_skeleton.sql'], files, 1)).toBe('refuse');
});
