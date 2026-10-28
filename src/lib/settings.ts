import { z } from 'zod';
import { normalizePhone } from './phone';

export type SettingModule = 'COMPANY' | 'HELP' | 'ORDERS' | 'PAYROLL';

type SettingDefinition = {
	module: SettingModule;
	label: string;
	unit: string | null;
	// An example in the stored format, shown in the empty field so it says what goes there.
	placeholder?: string;
	// Parses the stored `settings.value` TEXT into the key's real type.
	schema: z.ZodType;
};

// The messages reach the settings screen, next to the field.
const POSITIVE_INTEGER_MESSAGE = 'Escribe un número entero mayor que cero';
const PERCENTAGE_MESSAGE = 'Escribe un porcentaje de 0 a 100';

/** The help's limit, which its editor counts against. */
export const HELP_MAX_LENGTH = 50_000;

const textSchema = z.string().trim().min(1, 'Escribe un valor');
const positiveIntegerSchema = z.coerce
	.number(POSITIVE_INTEGER_MESSAGE)
	.int(POSITIVE_INTEGER_MESSAGE)
	.positive(POSITIVE_INTEGER_MESSAGE);
const clockTimeSchema = z.iso.time({ precision: -1 });
const dateWithLabelSchema = z.object({ date: z.iso.date(), label: textSchema });

// Strictly ascending dates rule out both duplicates and entries out of order.
export const holidaysSchema = z
	.array(dateWithLabelSchema)
	.refine(
		(holidays) => holidays.every((holiday, i) => 0 === i || holiday.date > holidays[i - 1].date),
		'Holidays must be sorted by date with no duplicates'
	);

const jsonTextSchema = z.string().transform((value, context) => {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		context.addIssue({ code: 'custom', message: 'Invalid JSON' });
		return z.NEVER;
	}
});

export const SETTINGS = {
	COMPANY_NAME: {
		module: 'COMPANY',
		label: 'Nombre de la empresa',
		unit: null,
		placeholder: 'Banquetes Consuelo C',
		schema: textSchema
	},
	COMPANY_ADDRESS: {
		module: 'COMPANY',
		label: 'Dirección',
		unit: null,
		placeholder: 'Calle 38a #79-18, Medellín',
		schema: textSchema
	},
	COMPANY_PHONE: {
		module: 'COMPANY',
		label: 'Teléfono',
		unit: null,
		placeholder: '604 411 44 29',
		schema: textSchema
	},
	// What `wa.me` takes, so stored normalized; empty hides the public pages' WhatsApp icon.
	COMPANY_WHATSAPP: {
		module: 'COMPANY',
		label: 'WhatsApp',
		unit: null,
		placeholder: '573105550142',
		schema: z
			.string()
			.trim()
			.transform((typed, context) => {
				const phone = '' === typed ? '' : normalizePhone(typed);
				if (null === phone) {
					context.addIssue({ code: 'custom', message: 'Escriba un número válido o déjelo vacío' });
					return z.NEVER;
				}
				return phone;
			})
	},
	ORDERS_SUGGESTED_ADVANCE_PCT: {
		module: 'ORDERS',
		label: 'Anticipo sugerido',
		unit: '%',
		placeholder: '50',
		schema: z.coerce
			.number(PERCENTAGE_MESSAGE)
			.int(PERCENTAGE_MESSAGE)
			.min(0, PERCENTAGE_MESSAGE)
			.max(100, PERCENTAGE_MESSAGE)
	},
	PAYROLL_MINIMUM_WAGE: {
		module: 'PAYROLL',
		label: 'Salario mínimo mensual',
		unit: 'pesos',
		placeholder: '1750905',
		schema: positiveIntegerSchema
	},
	PAYROLL_TRANSPORT_ALLOWANCE: {
		module: 'PAYROLL',
		label: 'Auxilio de transporte mensual',
		unit: 'pesos',
		placeholder: '249095',
		schema: positiveIntegerSchema
	},
	PAYROLL_DAYS_PER_MONTH: {
		module: 'PAYROLL',
		label: 'Días por mes',
		unit: 'días',
		placeholder: '30',
		schema: positiveIntegerSchema
	},
	PAYROLL_HOURS_PER_MONTH: {
		module: 'PAYROLL',
		label: 'Horas por mes',
		unit: 'horas',
		placeholder: '210',
		schema: positiveIntegerSchema
	},
	PAYROLL_ORDINARY_HOURS_PER_DAY: {
		module: 'PAYROLL',
		label: 'Horas ordinarias por día',
		unit: 'horas',
		placeholder: '7',
		schema: positiveIntegerSchema
	},
	PAYROLL_NIGHT_START: {
		module: 'PAYROLL',
		label: 'Inicio de jornada nocturna',
		unit: 'hora',
		placeholder: '19:00',
		schema: clockTimeSchema
	},
	PAYROLL_NIGHT_END: {
		module: 'PAYROLL',
		label: 'Fin de jornada nocturna',
		unit: 'hora',
		placeholder: '06:00',
		schema: clockTimeSchema
	},
	// Factors and rates are whole hundredths: 125 means 1.25, 4 means 0.04.
	PAYROLL_OVERTIME_DAY_FACTOR: {
		module: 'PAYROLL',
		label: 'Hora extra diurna',
		unit: '%',
		placeholder: '125',
		schema: positiveIntegerSchema
	},
	PAYROLL_OVERTIME_NIGHT_FACTOR: {
		module: 'PAYROLL',
		label: 'Hora extra nocturna',
		unit: '%',
		placeholder: '175',
		schema: positiveIntegerSchema
	},
	PAYROLL_HOLIDAY_OVERTIME_DAY_FACTOR: {
		module: 'PAYROLL',
		label: 'Hora extra diurna dominical o festiva',
		unit: '%',
		placeholder: '215',
		schema: positiveIntegerSchema
	},
	PAYROLL_HOLIDAY_OVERTIME_NIGHT_FACTOR: {
		module: 'PAYROLL',
		label: 'Hora extra nocturna dominical o festiva',
		unit: '%',
		placeholder: '265',
		schema: positiveIntegerSchema
	},
	PAYROLL_NIGHT_SURCHARGE_FACTOR: {
		module: 'PAYROLL',
		label: 'Recargo nocturno',
		unit: '%',
		placeholder: '35',
		schema: positiveIntegerSchema
	},
	PAYROLL_PENSION_RATE: {
		module: 'PAYROLL',
		label: 'Aporte a pensión del empleado',
		unit: '%',
		placeholder: '4',
		schema: positiveIntegerSchema
	},
	PAYROLL_HEALTH_RATE: {
		module: 'PAYROLL',
		label: 'Aporte a salud del empleado',
		unit: '%',
		placeholder: '4',
		schema: positiveIntegerSchema
	},
	PAYROLL_HOLIDAYS: {
		module: 'PAYROLL',
		label: 'Festivos',
		unit: null,
		schema: jsonTextSchema.pipe(holidaysSchema)
	},
	// One Markdown text, each `##` a question; its own editor, like PAYROLL_HOLIDAYS.
	HELP_FAQ: {
		module: 'HELP',
		label: 'Ayuda',
		unit: null,
		schema: z
			.string()
			.trim()
			.min(1, 'Escribe el texto de la ayuda')
			.max(HELP_MAX_LENGTH, 'La ayuda no puede pasar de 50.000 caracteres')
	}
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTINGS;

/** How the settings screen takes a key's value: a clock time, a whole number, or text. */
export function getSettingInput(key: SettingKey): 'clock' | 'number' | 'text' {
	const { unit } = SETTINGS[key];
	if ('hora' === unit) {
		return 'clock';
	}
	return null === unit ? 'text' : 'number';
}
