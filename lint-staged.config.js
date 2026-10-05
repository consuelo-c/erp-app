// Runs sequentially (--concurrent false in the hook) so formatters never race on the same file.
// ESLint goes before Prettier: its fixes (the braces `curly` adds) come out unformatted.
export default {
	'*.{js,ts,svelte}': [
		'eslint --fix --no-warn-ignored',
		'prettier --write',
		'vitest related --run --passWithNoTests'
	],
	'*.{css,svelte}': 'stylelint --fix --allow-empty-input',
	'*.{json,jsonc,md,yml,yaml,html}': 'prettier --write'
};
