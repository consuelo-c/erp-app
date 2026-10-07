-- Default settings, 2026 and 2027 Colombian holidays included. Not sample data: production needs
-- them too. deploy.yml applies this file on every deploy, and `npm run db:seed` loads it into the
-- local D1. Idempotent: an existing key is left as is, so an edit made in the app survives every
-- deploy. Writes no events row and creates no logins (phase 3's Worker creates admin).
-- Every value must pass its Zod schema in src/lib/settings.ts; settings-defaults.test.ts checks it.
INSERT INTO settings (key, value, created_at, created_by, updated_at, updated_by)
SELECT column1, column2, unixepoch(), 'system', unixepoch(), 'system'
FROM (VALUES
	('COMPANY_NAME', 'Banquetes Consuelo C'),
	('COMPANY_ADDRESS', 'Calle 38a #79-18, Medellín, Colombia'),
	('COMPANY_PHONE', '(+57) 604 411 44 29'),
	('ORDERS_SUGGESTED_ADVANCE_PCT', '50'),
	('PAYROLL_MINIMUM_WAGE', '1750905'),
	('PAYROLL_TRANSPORT_ALLOWANCE', '249095'),
	('PAYROLL_DAYS_PER_MONTH', '30'),
	('PAYROLL_HOURS_PER_MONTH', '210'),
	('PAYROLL_ORDINARY_HOURS_PER_DAY', '7'),
	('PAYROLL_NIGHT_START', '19:00'),
	('PAYROLL_NIGHT_END', '06:00'),
	('PAYROLL_OVERTIME_DAY_FACTOR', '125'),
	('PAYROLL_OVERTIME_NIGHT_FACTOR', '175'),
	('PAYROLL_HOLIDAY_OVERTIME_DAY_FACTOR', '215'),
	('PAYROLL_HOLIDAY_OVERTIME_NIGHT_FACTOR', '265'),
	('PAYROLL_NIGHT_SURCHARGE_FACTOR', '35'),
	('PAYROLL_PENSION_RATE', '4'),
	('PAYROLL_HEALTH_RATE', '4'),
	('PAYROLL_HOLIDAYS', json('[
		{"date": "2026-01-01", "label": "Año Nuevo"},
		{"date": "2026-01-12", "label": "Día de los Reyes Magos"},
		{"date": "2026-03-23", "label": "Día de San José"},
		{"date": "2026-04-02", "label": "Jueves Santo"},
		{"date": "2026-04-03", "label": "Viernes Santo"},
		{"date": "2026-05-01", "label": "Día del Trabajo"},
		{"date": "2026-05-18", "label": "Ascensión del Señor"},
		{"date": "2026-06-08", "label": "Corpus Christi"},
		{"date": "2026-06-15", "label": "Sagrado Corazón"},
		{"date": "2026-06-29", "label": "San Pedro y San Pablo"},
		{"date": "2026-07-20", "label": "Día de la Independencia"},
		{"date": "2026-08-07", "label": "Batalla de Boyacá"},
		{"date": "2026-08-17", "label": "La Asunción de la Virgen"},
		{"date": "2026-10-12", "label": "Día de la Raza"},
		{"date": "2026-11-02", "label": "Todos los Santos"},
		{"date": "2026-11-16", "label": "Independencia de Cartagena"},
		{"date": "2026-12-08", "label": "Inmaculada Concepción"},
		{"date": "2026-12-25", "label": "Navidad"},
		{"date": "2027-01-01", "label": "Año Nuevo"},
		{"date": "2027-01-11", "label": "Día de los Reyes Magos"},
		{"date": "2027-03-22", "label": "Día de San José"},
		{"date": "2027-03-25", "label": "Jueves Santo"},
		{"date": "2027-03-26", "label": "Viernes Santo"},
		{"date": "2027-05-01", "label": "Día del Trabajo"},
		{"date": "2027-05-10", "label": "Ascensión del Señor"},
		{"date": "2027-05-31", "label": "Corpus Christi"},
		{"date": "2027-06-07", "label": "Sagrado Corazón"},
		{"date": "2027-07-05", "label": "San Pedro y San Pablo"},
		{"date": "2027-07-20", "label": "Día de la Independencia"},
		{"date": "2027-08-07", "label": "Batalla de Boyacá"},
		{"date": "2027-08-16", "label": "La Asunción de la Virgen"},
		{"date": "2027-10-18", "label": "Día de la Raza"},
		{"date": "2027-11-01", "label": "Todos los Santos"},
		{"date": "2027-11-15", "label": "Independencia de Cartagena"},
		{"date": "2027-12-08", "label": "Inmaculada Concepción"},
		{"date": "2027-12-25", "label": "Navidad"}
	]'))
)
WHERE true -- Lets SQLite parse ON CONFLICT after a SELECT.
ON CONFLICT(key) DO NOTHING;
