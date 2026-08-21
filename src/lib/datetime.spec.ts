import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPANY_TIMEZONE, getTodaysDate, nowEpoch } from './datetime';

afterEach(() => {
	vi.useRealTimers();
});

/** Fija el reloj del proceso en un instante UTC. */
function at(utc: string) {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(utc));
}

describe('getTodaysDate', () => {
	it('a las 7 p.m. en Colombia todavía es hoy, aunque en UTC ya sea mañana', () => {
		// 7:30 p.m. del 21 de agosto en Medellín son las 00:30 del 22 en UTC.
		at('2026-08-22T00:30:00Z');

		expect(getTodaysDate(COMPANY_TIMEZONE)).toBe('2026-08-21');
		expect(getTodaysDate('UTC')).toBe('2026-08-22');
	});

	it('un cliente que consulta desde España ve un día distinto al de la operación', () => {
		// El caso de la sección 2.5: por eso la lógica de negocio nunca usa la
		// zona del visitante.
		at('2026-08-22T00:30:00Z');

		expect(getTodaysDate('Europe/Madrid')).toBe('2026-08-22');
		expect(getTodaysDate(COMPANY_TIMEZONE)).toBe('2026-08-21');
	});

	it('rellena mes y día a dos dígitos', () => {
		at('2026-03-05T12:00:00Z');

		expect(getTodaysDate(COMPANY_TIMEZONE)).toBe('2026-03-05');
	});

	it('al mediodía de Medellín coincide con UTC', () => {
		at('2026-08-21T17:00:00Z');

		expect(getTodaysDate(COMPANY_TIMEZONE)).toBe('2026-08-21');
		expect(getTodaysDate('UTC')).toBe('2026-08-21');
	});
});

describe('nowEpoch', () => {
	it('devuelve segundos, no milisegundos, y trunca hacia abajo', () => {
		at('2026-08-22T00:30:00.750Z');

		expect(nowEpoch()).toBe(1787358600);
	});
});
