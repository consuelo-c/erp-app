import { expect, test } from 'vitest';
import { isEnterControl, isFieldTarget, isSubmitControl, nextAfter } from './form-enter';

const textInput = { tagName: 'input', type: 'text', disabled: false };
const select = { tagName: 'select', type: 'select-one', disabled: false };
const radio = { tagName: 'input', type: 'radio', disabled: false };
const textarea = { tagName: 'textarea', type: 'textarea', disabled: false };
const submit = { tagName: 'button', type: 'submit', disabled: false };

test('Enter moves from typed inputs and selects, and from a choice', () => {
	expect(isEnterControl(textInput)).toBe(true);
	expect(isEnterControl(select)).toBe(true);
	expect(isEnterControl(radio)).toBe(true);
});

test('Enter never moves from a textarea, a button, or a disabled control', () => {
	expect(isEnterControl(textarea)).toBe(false);
	expect(isEnterControl(submit)).toBe(false);
	expect(isEnterControl({ ...textInput, disabled: true })).toBe(false);
	expect(isEnterControl({ tagName: 'input', type: 'submit', disabled: false })).toBe(false);
});

test('Enter lands on typed inputs and selects, never on a choice', () => {
	expect(isFieldTarget(textInput)).toBe(true);
	expect(isFieldTarget(select)).toBe(true);
	expect(isFieldTarget(radio)).toBe(false);
	expect(isFieldTarget({ tagName: 'input', type: 'checkbox', disabled: false })).toBe(false);
});

test('the submit button is the target from the last field', () => {
	expect(isSubmitControl(submit)).toBe(true);
	expect(isSubmitControl({ tagName: 'button', type: 'button', disabled: false })).toBe(false);
	expect(isSubmitControl({ tagName: 'input', type: 'submit', disabled: false })).toBe(true);
	expect(isSubmitControl({ ...submit, disabled: true })).toBe(false);
});

test('the next field is the first later one that qualifies, in order', () => {
	const hour = { name: 'hour' };
	const minute = { name: 'minute' };
	const period = { name: 'period', radio: true };
	const next = { name: 'next' };
	const controls = [hour, minute, period, next];
	const isTarget = (control: { name: string; radio?: boolean }) => !control.radio;

	expect(nextAfter(controls, hour, isTarget)).toBe(minute);
	expect(nextAfter(controls, minute, isTarget)).toBe(next);
});

test('no next field on the last one', () => {
	const last = { name: 'last' };
	expect(nextAfter([{ name: 'first' }, last], last, () => true)).toBeUndefined();
});
