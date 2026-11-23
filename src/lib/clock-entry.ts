// The typing rules of a clock field, pure so they're tested apart from the component.

/**
 * Whether the hour is complete once typed, so the cursor moves to the minutes. 2 to 9 can't take
 * another digit; 10, 11 and 12 are complete at their second. A lone 1 waits, as it may become 1x.
 */
export function isHourComplete(hour: string): boolean {
	return /^[2-9]$/.test(hour) || /^1[0-2]$/.test(hour);
}

/**
 * The a.m./p.m. a typed hour suggests: 7 to 11 are mornings, and 12 and 1 to 6 are afternoons,
 * which is most event and pickup times. Null for a blank or impossible hour.
 */
export function guessPeriod(hour: string): 'am' | 'pm' | null {
	if (!/^\d{1,2}$/.test(hour.trim())) {
		return null;
	}
	const value = Number(hour);
	if (value >= 7 && value <= 11) {
		return 'am';
	}
	if (12 === value || (value >= 1 && value <= 6)) {
		return 'pm';
	}
	return null;
}
