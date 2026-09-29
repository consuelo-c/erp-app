// Runs sequentially (--concurrent false in the hook) so formatters never race on the same file.
export default {
	'*.{js,ts,svelte}': [
		'prettier --write',
		'eslint --fix --no-warn-ignored',
		'vitest related --run --passWithNoTests'
	],
	'*.{css,svelte}': 'stylelint --fix --allow-empty-input',
	'*.{json,jsonc,md,yml,yaml,html}': 'prettier --write'
};
