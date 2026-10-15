// Tests only: just enough of D1 over node:sqlite, with every migration applied, to run services.
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

function statement(database: DatabaseSync, sql: string, params: SQLInputValue[] = []) {
	return {
		bind: (...values: SQLInputValue[]) => statement(database, sql, values),
		first: async () => database.prepare(sql).get(...params) ?? null,
		all: async () => ({ results: database.prepare(sql).all(...params) }),
		run: async () => database.prepare(sql).run(...params)
	};
}

export function createMemoryD1(): { db: D1Database; database: DatabaseSync } {
	const database = new DatabaseSync(':memory:');
	const files = readdirSync('migrations')
		.filter((file) => file.endsWith('.sql'))
		.sort();
	for (const file of files) {
		database.exec(readFileSync(`migrations/${file}`, 'utf8'));
	}
	// D1's batch is atomic: all statements or none. Each result carries D1's `meta.last_row_id`.
	const batch = async (statements: ReturnType<typeof statement>[]) => {
		database.exec('begin');
		try {
			const results = [];
			for (const each of statements) {
				const { lastInsertRowid } = await each.run();
				results.push({ meta: { last_row_id: Number(lastInsertRowid) } });
			}
			database.exec('commit');
			return results;
		} catch (error) {
			database.exec('rollback');
			throw error;
		}
	};
	const db = { prepare: (sql: string) => statement(database, sql), batch };
	return { db: db as unknown as D1Database, database };
}
