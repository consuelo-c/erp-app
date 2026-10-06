import { z } from 'zod';

type SettingDefinition = {
	module: 'COMPANY' | 'ORDERS' | 'PAYROLL';
	label: string;
	unit: string | null;
	// Parses the stored `settings.value` TEXT into the key's real type.
	schema: z.ZodType;
};

const textSchema = z.string().trim().min(1);
const positiveIntegerSchema = z.coerce.number().int().positive();
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
		schema: textSchema
	},
	COMPANY_ADDRESS: { module: 'COMPANY', label: 'Dirección', unit: null, schema: textSchema },
	COMPANY_PHONE: { module: 'COMPANY', label: 'Teléfono', unit: null, schema: textSchema },
	ORDERS_SUGGESTED_ADVANCE_PCT: {
		module: 'ORDERS',
		label: 'Anticipo sugerido',
		unit: '%',
		schema: z.coerce.number().int().min(0).max(100)
	},
	PAYROLL_MINIMUM_WAGE: {
		module: 'PAYROLL',
		label: 'Salario mínimo mensual',
		unit: 'pesos',
		schema: positiveIntegerSchema
	},
	PAYROLL_TRANSPORT_ALLOWANCE: {
		module: 'PAYROLL',
		label: 'Auxilio de transporte mensual',
		unit: 'pesos',
		schema: positiveIntegerSchema
	},
	PAYROLL_DAYS_PER_MONTH: {
		module: 'PAYROLL',
		label: 'Días por mes',
		unit: 'días',
		schema: positiveIntegerSchema
	},
	PAYROLL_HOURS_PER_MONTH: {
		module: 'PAYROLL',
		label: 'Horas por mes',
		unit: 'horas',
		schema: positiveIntegerSchema
	},
	PAYROLL_ORDINARY_HOURS_PER_DAY: {
		module: 'PAYROLL',
		label: 'Horas ordinarias por día',
		unit: 'horas',
		schema: positiveIntegerSchema
	},
	PAYROLL_NIGHT_START: {
		module: 'PAYROLL',
		label: 'Inicio de jornada nocturna',
		unit: 'hora',
		schema: clockTimeSchema
	},
	PAYROLL_NIGHT_END: {
		module: 'PAYROLL',
		label: 'Fin de jornada nocturna',
		unit: 'hora',
		schema: clockTimeSchema
	},
	// Factors and rates are whole hundredths: 125 means 1.25, 4 means 0.04.
	PAYROLL_OVERTIME_DAY_FACTOR: {
		module: 'PAYROLL',
		label: 'Hora extra diurna',
		unit: '%',
		schema: positiveIntegerSchema
	},
	PAYROLL_OVERTIME_NIGHT_FACTOR: {
		module: 'PAYROLL',
		label: 'Hora extra nocturna',
		unit: '%',
		schema: positiveIntegerSchema
	},
	PAYROLL_HOLIDAY_OVERTIME_DAY_FACTOR: {
		module: 'PAYROLL',
		label: 'Hora extra diurna dominical o festiva',
		unit: '%',
		schema: positiveIntegerSchema
	},
	PAYROLL_HOLIDAY_OVERTIME_NIGHT_FACTOR: {
		module: 'PAYROLL',
		label: 'Hora extra nocturna dominical o festiva',
		unit: '%',
		schema: positiveIntegerSchema
	},
	PAYROLL_NIGHT_SURCHARGE_FACTOR: {
		module: 'PAYROLL',
		label: 'Recargo nocturno',
		unit: '%',
		schema: positiveIntegerSchema
	},
	PAYROLL_PENSION_RATE: {
		module: 'PAYROLL',
		label: 'Aporte a pensión del empleado',
		unit: '%',
		schema: positiveIntegerSchema
	},
	PAYROLL_HEALTH_RATE: {
		module: 'PAYROLL',
		label: 'Aporte a salud del empleado',
		unit: '%',
		schema: positiveIntegerSchema
	},
	PAYROLL_HOLIDAYS: {
		module: 'PAYROLL',
		label: 'Festivos',
		unit: null,
		schema: jsonTextSchema.pipe(holidaysSchema)
	}
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTINGS;
