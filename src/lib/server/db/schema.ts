import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';

// Throwaway table: it only proves the migration step runs in CI. Phase 02 squashes it away.
export const skeleton = sqliteTable('skeleton', {
	id: integer('id').primaryKey()
});
