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

const USAGE = 'Usage: node scripts/wipe-d1-if-squashed.js --remote | --local [--yes]';
const LIST_OBJECTS_SQL =
	"select type, name from sqlite_master where type in ('table', 'view') and name not glob 'sqlite_*' and name not glob '_cf_*'";

/**
 * Compares the migrations D1 has applied with the files in migrations/.
 * 'none': they still match (applied is a prefix of files), nothing to wipe.
 * 'wipe': migrations/ was squashed and `orders` is empty or missing.
 * 'refuse': migrations/ was squashed but `orders` has rows.
 * @returns {'none' | 'wipe' | 'refuse'}
 */
export function resolveMigrationDrift(applied, files, orderCount) {
	const isPrefix = applied.every((name, i) => name === files[i]);
	if (isPrefix) {
		return 'none';
	}
	return orderCount > 0 ? 'refuse' : 'wipe';
}

/** `name (remote)` or `name (local)`, for the messages. */
function describeDatabase(database) {
	return `${database.name} (${database.target.slice(2)})`;
}

/** The `wrangler d1 execute` arguments that run `sql` on `database` ({ name, target }). */
function executeArguments(database, sql) {
	return ['wrangler', 'd1', 'execute', database.name, database.target, '--command', sql];
}

/** Runs `sql` on `database` and returns the result rows. */
function executeSql(database, sql) {
	const output = execFileSync('npx', [...executeArguments(database, sql), '--json'], {
		encoding: 'utf8'
	});
	return JSON.parse(output)[0].results;
}

/** Runs `sql` on `database` and prints the result rows as a table. */
function printQuery(database, sql) {
	execFileSync('npx', executeArguments(database, sql), { stdio: 'inherit' });
}

/** The target (`--remote` or `--local`) and `--yes` from the command line; exits on bad usage. */
function parseOptions() {
	const { values } = parseArgs({
		options: {
			remote: { type: 'boolean' },
			local: { type: 'boolean' },
			yes: { type: 'boolean' }
		}
	});
	if (values.remote === values.local) {
		console.error(USAGE);
		process.exit(2);
	}
	return { target: values.remote ? '--remote' : '--local', skipConfirmation: Boolean(values.yes) };
}

/** The D1 database name from `wrangler.jsonc`. */
async function readDatabaseName() {
	// Imported here, not at the top, so the test importing this file doesn't load wrangler.
	const { unstable_readConfig } = await import('wrangler');
	return unstable_readConfig({}).d1_databases[0].database_name;
}

function readMigrationFiles() {
	return readdirSync('migrations')
		.filter((file) => file.endsWith('.sql'))
		.sort();
}

/**
 * What the wipe decision needs from `database`: its tables and views, the migrations it has
 * applied, and the rows in `orders` (null when the table doesn't exist).
 */
function inspectDatabase(database) {
	const objects = executeSql(database, LIST_OBJECTS_SQL);
	const names = new Set(objects.map((object) => object.name));
	const applied = names.has('d1_migrations')
		? executeSql(database, 'select name from d1_migrations order by id').map((row) => row.name)
		: [];
	const orderCount = names.has('orders')
		? executeSql(database, 'select count(*) as count from orders')[0].count
		: null;
	return { objects, applied, orderCount };
}

function printState(applied, files, orderCount) {
	console.log(`Applied in D1:    ${applied.join(', ') || '(none)'}`);
	console.log(`In migrations/:   ${files.join(', ') || '(none)'}`);
	console.log(`Rows in orders:   ${orderCount ?? '(no table)'}`);
}

/** Shows the rows in `orders` and exits with an error, without touching the database. */
function refuseWipe(database) {
	console.error('Applied migrations no longer match migrations/, but `orders` has rows:');
	printQuery(database, 'select id, created_at from orders');
	console.error(
		'Refusing to wipe. If, and only if, these are test rows: run `delete from orders` and re-run.'
	);
	process.exit(1);
}

/**
 * Asks on the terminal whether to drop every table in `database`. Answering anything but "y"
 * means no. Without a terminal (CI, piped input) it returns false without asking: pass --yes there.
 * @returns {Promise<boolean>} true only if the answer was "y"
 */
async function confirmWipe(database) {
	if (!process.stdin.isTTY) {
		return false;
	}
	const prompt = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await prompt.question(`Drop every table in ${describeDatabase(database)}? [y/N] `);
	prompt.close();
	return 'y' === answer.trim().toLowerCase();
}

function dropObjects(database, objects) {
	const drops = objects.map((object) => `drop ${object.type} if exists "${object.name}"`);
	executeSql(database, ['pragma defer_foreign_keys = on', ...drops].join('; '));
}

/** Drops every table and view in `database`, after confirming unless `skipConfirmation`. */
async function wipe(database, objects, skipConfirmation) {
	const names = objects.map((object) => object.name);
	console.log('Applied migrations no longer match migrations/ and `orders` is empty.');
	console.log(`Will drop from ${describeDatabase(database)}: ${names.join(', ')}`);
	const isConfirmed = skipConfirmation || (await confirmWipe(database));
	if (!isConfirmed) {
		console.error('Not confirmed: nothing was dropped. Pass --yes to skip the question.');
		process.exit(1);
	}
	dropObjects(database, objects);
	console.log(
		`Wiped ${database.name}. The next \`wrangler d1 migrations apply\` starts from scratch.`
	);
}

async function main() {
	const { target, skipConfirmation } = parseOptions();
	const database = { name: await readDatabaseName(), target };
	console.log(`Checking ${describeDatabase(database)} against migrations/.`);

	const { objects, applied, orderCount } = inspectDatabase(database);
	const files = readMigrationFiles();
	printState(applied, files, orderCount);

	const drift = resolveMigrationDrift(applied, files, orderCount ?? 0);
	if ('none' === drift) {
		console.log('Applied migrations match migrations/: nothing to wipe.');
		return;
	}
	if ('refuse' === drift) {
		refuseWipe(database);
		return;
	}
	await wipe(database, objects, skipConfirmation);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
