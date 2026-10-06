// Workers run in UTC and browsers in the device's zone; every date the app uses is Bogotá's.
const COMPANY_TIMEZONE = 'America/Bogota';

// en-CA formats dates as YYYY-MM-DD.
const civilDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TIMEZONE });

const instantFormat = new Intl.DateTimeFormat('es-CO', {
	timeZone: COMPANY_TIMEZONE,
	dateStyle: 'long',
	timeStyle: 'short'
});

/** Current date (YYYY-MM-DD) in Bogotá. */
export function getTodaysDate(): string {
	return civilDateFormat.format(new Date());
}

/** A UTC instant (epoch seconds) formatted in Bogotá time, for display. */
export function formatInstant(epochSeconds: number): string {
	return instantFormat.format(new Date(epochSeconds * 1000));
}
