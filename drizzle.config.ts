import { defineConfig } from 'drizzle-kit';

// Only `drizzle-kit generate` is used; migrations are applied with `wrangler d1 migrations apply`.
export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './migrations',
	dialect: 'sqlite',
	verbose: true,
	strict: true
});
