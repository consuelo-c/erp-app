import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	{ ignores: ['worker-configuration.d.ts', 'migrations/'] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		// Readability rules: Run after `prettier`, which turns `curly` off.
		plugins: { unicorn },
		rules: {
			yoda: ['error', 'always', { onlyEquality: true }],
			curly: ['error', 'all'],
			complexity: ['error', 8],
			'max-depth': ['error', 2],
			'max-params': ['error', 3],
			'max-lines-per-function': ['error', { max: 30, skipBlankLines: true, skipComments: true }],
			'no-nested-ternary': 'error',
			'no-else-return': 'error',
			'id-length': ['error', { min: 2, exceptions: ['i', 'j', '_'] }],
			'unicorn/name-replacements': [
				'error',
				{ allowList: { db: true, env: true, params: true, props: true, i: true, j: true } }
			],
			'@typescript-eslint/naming-convention': [
				'error',
				{ selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
				{ selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
				// SvelteKit's endpoint handlers: GET, POST…
				{ selector: 'function', format: ['camelCase', 'UPPER_CASE'] },
				// Snake_case D1 columns destructured from a row.
				{ selector: 'variable', modifiers: ['destructured'], format: null },
				{ selector: 'typeLike', format: ['PascalCase'] },
				{ selector: ['objectLiteralProperty', 'typeProperty', 'import'], format: null }
			]
		}
	},
	{
		files: ['**/*.test.{ts,js}'],
		rules: { 'max-lines-per-function': 'off' }
	}
);
