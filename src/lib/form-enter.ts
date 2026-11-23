// Enter moves through a form's fields instead of submitting it, so a rep can't send a form by
// pressing Enter in the middle of typing. The rules are pure over plain descriptions of controls,
// so they're tested apart from the DOM; `moveOnEnter` is the only part that touches it.

export type ControlDescription = { tagName: string; type: string; disabled: boolean };

// Inputs that don't take typed text: pressing Enter on them does their own job, not a move.
const NOT_TYPED_INPUT_TYPES = ['submit', 'reset', 'button', 'image', 'file', 'hidden'];
// Choices, not typed fields: Enter from one still moves on, but Enter never lands on one.
const CHOICE_INPUT_TYPES = ['radio', 'checkbox'];

/** A control Enter moves from: a typed input or a select. Textareas keep their newlines. */
export function isEnterControl(control: ControlDescription): boolean {
	if (control.disabled) {
		return false;
	}
	if ('select' === control.tagName) {
		return true;
	}
	return 'input' === control.tagName && !NOT_TYPED_INPUT_TYPES.includes(control.type);
}

/** A control Enter can land on: an Enter control that isn't a choice. */
export function isFieldTarget(control: ControlDescription): boolean {
	return isEnterControl(control) && !CHOICE_INPUT_TYPES.includes(control.type);
}

/** The submit button Enter focuses from the last field. */
export function isSubmitControl(control: ControlDescription): boolean {
	const isButton = 'button' === control.tagName || 'input' === control.tagName;
	return isButton && 'submit' === control.type && !control.disabled;
}

/** The first item after `current` that qualifies, in order; undefined on the last one. */
export function nextAfter<T>(
	items: readonly T[],
	current: T,
	qualifies: (item: T) => boolean
): T | undefined {
	const index = items.indexOf(current);
	return items.slice(index + 1).find(qualifies);
}

// Structural, so an input and a select both fit without the DOM typings' Element conflict.
function describe(element: {
	tagName: string;
	type?: string;
	disabled?: boolean;
}): ControlDescription {
	return {
		tagName: element.tagName.toLowerCase(),
		type: element.type ?? '',
		disabled: element.disabled ?? false
	};
}

type FormControl = HTMLInputElement | HTMLSelectElement;

// Only Enter from a control inside a form, and one that hasn't already handled Enter (a search
// field opening its first result, say), is the form's to move.
function enterControlOf(event: KeyboardEvent): FormControl | null {
	if ('Enter' !== event.key || event.isComposing || event.defaultPrevented) {
		return null;
	}
	const target = event.target;
	const isFormControl = target instanceof HTMLInputElement || target instanceof HTMLSelectElement;
	if (!isFormControl || null === target.form || !isEnterControl(describe(target))) {
		return null;
	}
	return target;
}

function focusAfter(control: FormControl): void {
	const controls = Array.from(control.form?.elements ?? []);
	const next =
		nextAfter<Element>(controls, control as Element, (item) => isFieldTarget(describe(item))) ??
		controls.find((item) => isSubmitControl(describe(item)));
	(next as HTMLElement | undefined)?.focus();
}

/**
 * Enter in a form control moves focus to the next field, and the last field focuses the form's
 * submit button. Never submits on Enter; a click does.
 */
export function moveOnEnter(event: KeyboardEvent): void {
	const control = enterControlOf(event);
	if (null === control) {
		return;
	}
	event.preventDefault();
	focusAfter(control);
}
