/** @type {import('stylelint').Config} */
export default {
	extends: [
		'stylelint-config-standard',
		'stylelint-config-html/svelte',
		'stylelint-config-recess-order'
	],
	rules: {
		// The Design System names classes BEM-style: `.block`, `.block__part`, `.block--variant`.
		'selector-class-pattern': [
			'^[a-z][a-z0-9]*(-[a-z0-9]+)*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$',
			{ message: (selector) => `Expected class selector "${selector}" to be kebab-case BEM` }
		],
		'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global'] }]
	}
};
