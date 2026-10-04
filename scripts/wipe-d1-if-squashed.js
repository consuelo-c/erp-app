// Wipes the D1 database when migrations/ was squashed, so the deploy can apply it from scratch.
// Run by the deploy workflow before `wrangler d1 migrations apply`. Before launch, migrations/ is
// squashed freely, and the migrations D1 has applied stop being a prefix of migrations/. The wipe
// only happens if `orders` is missing or empty: the first real order freezes the schema.
// Usage: node scripts/wipe-d1-if-squashed.js --remote | --local [--yes]
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * Compares the migrations D1 has applied with the files in migrations/.
 * 'none': they still match (applied is a prefix of files), nothing to wipe.
 * 'wipe': migrations/ was squashed and `orders` is empty or missing.
 * 'refuse': migrations/ was squashed but `orders` has rows.
 * @returns {'none' | 'wipe' | 'refuse'}
 */
export function resolveMigrationDrift(applied, files, orderCount) {
	if (applied.every((name, i) => name === files[i])) return 'none';
	return orderCount > 0 ? 'refuse' : 'wipe';
}

/** Runs `sql` on the D1 database with `wrangler d1 execute`; returns the rows, or prints them as a table. */
function executeSql(db, target, sql, json = true) {
	const args = ['wrangler', 'd1', 'execute', db, target, '--command', sql];
	if (!json) return execFileSync('npx', args, { stdio: 'inherit' });
	return JSON.parse(execFileSync('npx', [...args, '--json'], { encoding: 'utf8' }))[0].results;
}

/**
 * Asks on the terminal whether to drop every table in the D1 database `db` on `target`
 * ('--remote' or '--local'). Answering anything but "y" means no. Without a terminal
 * (CI, piped input) it returns false without asking: pass --yes there.
 * @returns {Promise<boolean>} true only if the answer was "y"
 */
async function confirmWipe(db, target) {
	if (!process.stdin.isTTY) return false;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await rl.question(`Drop every table in ${db} (${target.slice(2)})? [y/N] `);
	rl.close();
	return 'y' === answer.trim().toLowerCase();
}

async function main() {
	const { values } = parseArgs({
		options: {
			remote: { type: 'boolean' },
			local: { type: 'boolean' },
			yes: { type: 'boolean' }
		}
	});
	if (values.remote === values.local) {
		console.error('Usage: node scripts/wipe-d1-if-squashed.js --remote | --local [--yes]');
		process.exit(2);
	}
	const target = values.remote ? '--remote' : '--local';

	// Imported here, not at the top, so the test importing this file doesn't load wrangler.
	const { unstable_readConfig } = await import('wrangler');
	const db = unstable_readConfig({}).d1_databases[0].database_name;
	console.log(`Checking ${db} (${target.slice(2)}) against migrations/.`);

	const objects = executeSql(
		db,
		target,
		"select type, name from sqlite_master where type in ('table', 'view') and name not glob 'sqlite_*' and name not glob '_cf_*'"
	);
	const names = new Set(objects.map((o) => o.name));
	const applied = names.has('d1_migrations')
		? executeSql(db, target, 'select name from d1_migrations order by id').map((r) => r.name)
		: [];
	const files = readdirSync('migrations')
		.filter((f) => f.endsWith('.sql'))
		.sort();
	const orderCount = names.has('orders')
		? executeSql(db, target, 'select count(*) as n from orders')[0].n
		: 0;

	console.log(`Applied in D1:    ${applied.join(', ') || '(none)'}`);
	console.log(`In migrations/:   ${files.join(', ') || '(none)'}`);
	console.log(`Rows in orders:   ${names.has('orders') ? orderCount : '(no table)'}`);

	const drift = resolveMigrationDrift(applied, files, orderCount);

	if ('none' === drift) {
		console.log('Applied migrations match migrations/: nothing to wipe.');
		return;
	}

	if ('refuse' === drift) {
		console.error('Applied migrations no longer match migrations/, but `orders` has rows:');
		executeSql(db, target, 'select id, created_at from orders', false);
		console.error(
			'Refusing to wipe. If, and only if, these are test rows: run `delete from orders` and re-run.'
		);
		process.exit(1);
	}

	console.log('Applied migrations no longer match migrations/ and `orders` is empty.');
	console.log(`Will drop from ${db} (${target.slice(2)}): ${[...names].join(', ')}`);
	if (!values.yes && !(await confirmWipe(db, target))) {
		console.error('Not confirmed: nothing was dropped. Pass --yes to skip the question.');
		process.exit(1);
	}

	const drops = objects.map((o) => `drop ${o.type} if exists "${o.name}"`);
	executeSql(db, target, ['pragma defer_foreign_keys = on', ...drops].join('; '));
	console.log(`Wiped ${db}. The next \`wrangler d1 migrations apply\` starts from scratch.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
