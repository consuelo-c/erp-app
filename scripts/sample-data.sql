-- Sample data, development only: the Design Brief's products, a few contacts, five employees, a login
-- per role on four of them, their punches from 10 to 18 October 2026, thirty orders (the brief's
-- three and twenty-seven generated ones), three counts, and the orders' and standalone cash movements.
-- `npm run db:seed` loads it into the local D1 after settings-defaults.sql; deploy.yml never applies
-- it. Idempotent: a product whose name exists, a contact whose document exists, an employee whose
-- contact exists, a login whose username exists, a punch whose employee and day exist, or an order,
-- count or movement whose id exists, is skipped, so a password admin set survives.
-- Writes no events row.
-- Every JSON must pass its Zod schema in the services; sample-data.test.ts checks it.
INSERT INTO products (name, category, variant_group, variant_name, rental_price, total_quantity, created_at, created_by, updated_at, updated_by)
SELECT column1, column2, column3, column4, column5, column6, unixepoch(), 'system', unixepoch(), 'system'
FROM (VALUES
	('Silla Tiffany dorada', 'CHAIRS_TABLES', NULL, NULL, 2500, 800),
	('Mesa redonda 10 puestos', 'CHAIRS_TABLES', NULL, NULL, 12000, 60),
	('Mantel blanco 3×3', 'LINENS', NULL, NULL, 8000, 120),
	('Copa para vino tinto', 'GLASSWARE', NULL, NULL, 900, 900),
	('Tenedor de mesa', 'CUTLERY', NULL, NULL, 600, 900),
	('Plato pando 26cm', 'TABLEWARE', NULL, NULL, 800, 700),
	('Samovar rectangular', 'CHAFERS_TRAYS', NULL, NULL, 35000, 18),
	('Candelabro de piso 5 brazos', 'DECOR', NULL, NULL, 18000, 24),
	('Mantel cuadrado 50×50 — Dorado', 'LINENS', 'Mantel cuadrado 50×50', 'Dorado', 9500, 40),
	('Mantel cuadrado 50×50 — Rojo', 'LINENS', 'Mantel cuadrado 50×50', 'Rojo', 8000, 60),
	('Mantel cuadrado 50×50 — Verde', 'LINENS', 'Mantel cuadrado 50×50', 'Verde', 8000, 55),
	('Mantel cuadrado 50×50 — Azul', 'LINENS', 'Mantel cuadrado 50×50', 'Azul', 8000, 30)
) AS sample
WHERE NOT EXISTS (SELECT 1 FROM products WHERE products.name = sample.column1);

-- A client who gave no document gets a fixed automatic one, `@` and 8 Crockford base32 symbols, as
-- the app would make up; fixed so a second run finds it.
INSERT INTO contacts (phone, full_name, document_id, services, attributes, created_at, created_by, updated_at, updated_by)
SELECT column1, column2, column3, column4, column5, unixepoch(), 'system', unixepoch(), 'system'
FROM (VALUES
	('573104428890', 'Luz Marina Restrepo', '1036452118', '[]', '{"email":"luzmarina.r@gmail.com","address_1":"Cra 43A #18-95, El Poblado","address_2":"Salón Social Torre Verde, piso 2","notes":"Prefiere que lo llamen después de las 2"}'),
	('573007712043', 'Jorge Iván Betancur', '@7Q2M9KXA', '[]', '{}'),
	('573119085512', 'Wilson Muñoz', '98552017', '["TRANSPORTER"]', '{"bank_account":"Nequi 311 908 5512"}'),
	('573125557788', 'Paula Andrea Ríos', '@3HWD8RNE', '["DECORATOR"]', '{"notes":"Arreglos florales y centros de mesa"}'),
	('13055550142', 'Emily Carter', '@C5VB0PZT', '[]', '{"email":"emily.carter@example.com"}'),
	('573006152290', 'Diana Zuluaga', '@4MZT7QJD', '[]', '{"address_1":"Calle 10 Sur #50-120, El Poblado","address_2":"Club Campestre Las Palmas, salón Orquídea"}')
) AS sample
WHERE true -- SQLite reads ON CONFLICT after a SELECT only past a WHERE
ON CONFLICT (document_id) DO NOTHING;

-- Five employees, each on its own contact with a real ID number: four still employed, one a login
-- each below, and one who left in June, with no login and no punches.
INSERT INTO contacts (phone, full_name, document_id, services, attributes, created_at, created_by, updated_at, updated_by)
SELECT column1, column2, column3, '[]', '{}', unixepoch(), 'system', unixepoch(), 'system'
FROM (VALUES
	('573158840271', 'Gloria Patricia Arango', '43562781'),
	('573017265439', 'Natalia Cardona', '1037598420'),
	('573206613087', 'Jhon Fredy Osorio', '1128401956'),
	('573148092215', 'Luis Alberto Mejía', '71698342'),
	('573005519648', 'Óscar Darío Restrepo', '1017224563')
) AS sample
WHERE true -- SQLite reads ON CONFLICT after a SELECT only past a WHERE
ON CONFLICT (document_id) DO NOTHING;

INSERT INTO employees (contact_id, attributes, created_at, created_by, updated_at, updated_by)
SELECT (SELECT id FROM contacts WHERE document_id = column1), column2, unixepoch(), 'system', unixepoch(), 'system'
FROM (VALUES
	('43562781', '{"monthly_salary":3200000,"position":"Gerente","salary_bank_account":"Bancolombia ahorros 102-845631-27","employment":[{"start":"2019-02-04","end":null}]}'),
	('1037598420', '{"monthly_salary":2100000,"position":"Ventas","salary_bank_account":"Bancolombia ahorros 245-118903-54","employment":[{"start":"2022-07-11","end":null}]}'),
	('1128401956', '{"monthly_salary":1750905,"position":"Bodega","salary_bank_account":"Nequi 320 661 3087","employment":[{"start":"2021-03-01","end":"2021-12-23"},{"start":"2023-01-16","end":null}]}'),
	('71698342', '{"monthly_salary":1900000,"position":"Conductor","salary_bank_account":"Davivienda ahorros 0570 1946 2208","employment":[{"start":"2020-09-14","end":null}]}'),
	('1017224563', '{"monthly_salary":1750905,"position":"Auxiliar de bodega","salary_bank_account":"Nequi 300 551 9648","employment":[{"start":"2024-03-04","end":"2026-06-30"}]}')
) AS sample
WHERE true -- SQLite reads ON CONFLICT after a SELECT only past a WHERE
ON CONFLICT (contact_id) DO NOTHING;

-- A login per role, each on its employee, with no password: the empty hash matches none, and none
-- is in the repository. Each signs in once admin sets one in Logins › Contraseña.
INSERT INTO users (username, roles, employee_id, password_hash, password_salt, password_iterations, created_at, created_by, updated_at, updated_by)
SELECT column1, column2,
	(SELECT employees.id FROM employees JOIN contacts ON contacts.id = employees.contact_id WHERE contacts.document_id = column3),
	'', '', 10000, unixepoch(), 'system', unixepoch(), 'system'
FROM (VALUES
	('gerente', '["MANAGER"]', '43562781'),
	('representante', '["SALES"]', '1037598420'),
	('bodega', '["WAREHOUSE"]', '1128401956'),
	('conductor', '["DRIVER"]', '71698342')
) AS sample
WHERE true -- SQLite reads ON CONFLICT after a SELECT only past a WHERE
ON CONFLICT (username) DO NOTHING;

-- Saturday 10 to Sunday 18 October 2026, so Horas shows the week of the 12th whole. Its settlement's
-- extra hours, Saturday 10 to Friday 16, fill the five rows with the default settings (7 ordinary
-- hours, night from 19:00 to 06:00): the night surcharge (bodega on Tuesday 13 and conductor on
-- Friday 16 starting before 06:00), daytime and night overtime (conductor on Saturday 10 until
-- 22:00), daytime and night holiday overtime (Sunday 11, and Monday 12, Día de la Raza). Nobody
-- punched on Thursday 15. No settlement: Nómina works the draft out when it opens.
INSERT INTO timesheets (employee_id, work_date, morning_in, morning_out, afternoon_in, afternoon_out, created_at, created_by, updated_at, updated_by)
SELECT (SELECT employees.id FROM employees JOIN contacts ON contacts.id = employees.contact_id WHERE contacts.document_id = column1),
	column2, column3, column4, column5, column6, unixepoch(), 'system', unixepoch(), 'system'
FROM (VALUES
	('43562781', '2026-10-10', '08:00', '12:00', NULL, NULL),
	('43562781', '2026-10-13', '08:00', '12:00', '13:00', '16:00'),
	('43562781', '2026-10-14', '08:00', '12:00', '13:00', '18:00'),
	('43562781', '2026-10-16', '08:00', '12:00', '13:00', '16:00'),
	('43562781', '2026-10-17', '08:00', '12:00', NULL, NULL),
	('1037598420', '2026-10-10', '08:00', '12:00', '13:00', '16:00'),
	('1037598420', '2026-10-13', '08:00', '12:00', '13:00', '16:00'),
	('1037598420', '2026-10-14', '08:00', '12:00', '13:00', '16:00'),
	('1037598420', '2026-10-16', '08:00', '12:00', '13:00', '16:30'),
	('1037598420', '2026-10-17', '08:00', '12:00', NULL, NULL),
	('1128401956', '2026-10-10', '08:00', '12:00', '13:00', '16:00'),
	('1128401956', '2026-10-11', '07:00', '12:00', NULL, NULL),
	('1128401956', '2026-10-12', '08:00', '12:00', NULL, NULL),
	('1128401956', '2026-10-13', '05:30', '12:00', '13:00', '16:00'),
	('1128401956', '2026-10-14', '08:00', '12:00', '13:00', '16:00'),
	('1128401956', '2026-10-16', '08:00', '12:00', '13:00', '18:00'),
	('1128401956', '2026-10-17', '08:00', '12:00', '13:00', '16:00'),
	('71698342', '2026-10-10', '07:00', '12:00', '14:00', '22:00'),
	('71698342', '2026-10-11', '08:00', '12:00', '18:00', '21:00'),
	('71698342', '2026-10-12', '08:00', '11:00', NULL, NULL),
	('71698342', '2026-10-13', '08:00', '12:00', '13:00', '16:00'),
	('71698342', '2026-10-14', '08:00', '12:00', '13:00', '16:00'),
	('71698342', '2026-10-16', '05:00', '12:00', '13:00', '14:00'),
	('71698342', '2026-10-17', '07:00', '12:00', '14:00', '20:00'),
	('71698342', '2026-10-18', '08:00', '12:00', NULL, NULL)
) AS sample
WHERE true -- SQLite reads ON CONFLICT after a SELECT only past a WHERE
ON CONFLICT (employee_id, work_date) DO NOTHING;

-- The Design Brief's #1043 and #1051, and #1047 to try editing and an extension: explicit ids, so they
-- read as in the brief, and fixed tokens, so a second run finds them. Clients, carriers and products
-- are looked up by document and name, never by a rowid another seed run may have moved. The totals
-- follow the formula; their payments are the cash movements at the end.
INSERT INTO orders (id, public_token, client_id, status, event_date, delivery_date, pickup_date, rental_days, client_attributes, delivery_attributes, pickup_attributes, order_items, items_total, discount, transport_cost, order_total, deposit_amount, attributes, created_at, created_by, updated_at, updated_by)
VALUES
	(1043, '3f1c2b7a-8d4e-4c1a-9b2f-0a1d5e7c1043', (SELECT id FROM contacts WHERE document_id = '1036452118'), 'CONFIRMED',
		'2026-08-15', '2026-08-14', '2026-08-16', 2,
		'{"name":"Luz Marina Restrepo","phone":"573104428890"}',
		'{"method":"COMPANY_DELIVERY","time":"14:00","address_1":"Cra 43A #18-95, El Poblado","address_2":"Salón Social Torre Verde, piso 2","carrier":null,"notes":null}',
		'{"method":"COMPANY_PICKUP","time":"09:00","address_1":"Cra 43A #18-95, El Poblado","address_2":"Salón Social Torre Verde, piso 2","carrier":null,"notes":null}',
		json_array(
			json_object('product_id', (SELECT id FROM products WHERE name = 'Silla Tiffany dorada'), 'name', 'Silla Tiffany dorada', 'qty', 120, 'list_price', 2500, 'unit_price', 2500, 'line_total', 600000),
			json_object('product_id', (SELECT id FROM products WHERE name = 'Mesa redonda 10 puestos'), 'name', 'Mesa redonda 10 puestos', 'qty', 12, 'list_price', 12000, 'unit_price', 12000, 'line_total', 288000),
			json_object('product_id', (SELECT id FROM products WHERE name = 'Copa para vino tinto'), 'name', 'Copa para vino tinto', 'qty', 120, 'list_price', 900, 'unit_price', 900, 'line_total', 216000)
		),
		1104000, 104000, 180000, 1180000, 200000,
		'{"notes":"Entrar por el portón de servicio. Llamar 30 minutos antes de llegar."}',
		unixepoch(), 'system', unixepoch(), 'system'),
	(1047, '9a6e4d21-5b7c-4f3e-8a1d-2c4b6e8f1047', (SELECT id FROM contacts WHERE document_id = '@4MZT7QJD'), 'DELIVERED',
		'2026-08-15', '2026-08-14', '2026-08-18', 2,
		'{"name":"Diana Zuluaga","phone":"573006152290"}',
		json_object('method', 'EXTERNAL_CARRIER', 'time', '14:00', 'address_1', 'Calle 10 Sur #50-120, El Poblado', 'address_2', 'Club Campestre Las Palmas, salón Orquídea',
			'carrier', json_object('id', (SELECT id FROM contacts WHERE document_id = '98552017'), 'name', 'Wilson Muñoz', 'phone', '573119085512'), 'notes', NULL),
		json_object('method', 'EXTERNAL_CARRIER', 'time', '09:00', 'address_1', 'Calle 10 Sur #50-120, El Poblado', 'address_2', 'Club Campestre Las Palmas, salón Orquídea',
			'carrier', json_object('id', (SELECT id FROM contacts WHERE document_id = '98552017'), 'name', 'Wilson Muñoz', 'phone', '573119085512'), 'notes', NULL),
		json_array(
			json_object('product_id', (SELECT id FROM products WHERE name = 'Silla Tiffany dorada'), 'name', 'Silla Tiffany dorada', 'qty', 100, 'list_price', 2500, 'unit_price', 2500, 'line_total', 500000),
			json_object('product_id', (SELECT id FROM products WHERE name = 'Mesa redonda 10 puestos'), 'name', 'Mesa redonda 10 puestos', 'qty', 10, 'list_price', 12000, 'unit_price', 12000, 'line_total', 240000),
			json_object('product_id', (SELECT id FROM products WHERE name = 'Copa para vino tinto'), 'name', 'Copa para vino tinto', 'qty', 100, 'list_price', 900, 'unit_price', 900, 'line_total', 180000)
		),
		920000, 0, 220000, 1140000, 150000,
		'{"notes":"Montaje en la terraza del salón."}',
		unixepoch(), 'system', unixepoch(), 'system'),
	(1051, '5d2b8f16-0e3a-4b7c-9d4f-6a8c0e2b1051', (SELECT id FROM contacts WHERE document_id = '@7Q2M9KXA'), 'DRAFT',
		'2026-08-22', '2026-08-20', '2026-08-24', 2,
		'{"name":"Jorge Iván Betancur","phone":"573007712043"}',
		'{"method":"CLIENT_PICKUP","time":"08:00","address_1":"Calle 38a #79-18, Medellín, Colombia","address_2":null,"carrier":null,"notes":null}',
		json_object('method', 'EXTERNAL_CARRIER', 'time', '09:00', 'address_1', 'Calle 49 #70-35, Laureles', 'address_2', 'Casa de dos pisos, reja negra',
			'carrier', json_object('id', (SELECT id FROM contacts WHERE document_id = '98552017'), 'name', 'Wilson Muñoz', 'phone', '573119085512'), 'notes', NULL),
		json_array(
			json_object('product_id', (SELECT id FROM products WHERE name = 'Silla Tiffany dorada'), 'name', 'Silla Tiffany dorada', 'qty', 60, 'list_price', 2500, 'unit_price', 2500, 'line_total', 300000),
			json_object('product_id', (SELECT id FROM products WHERE name = 'Mesa redonda 10 puestos'), 'name', 'Mesa redonda 10 puestos', 'qty', 6, 'list_price', 12000, 'unit_price', 12000, 'line_total', 144000)
		),
		444000, 44000, 60000, 460000, 100000,
		'{"notes":"Recoge en camioneta propia."}',
		unixepoch(), 'system', unixepoch(), 'system')
ON CONFLICT (id) DO NOTHING;

-- Twenty-seven more, ids 1010–1036 below the brief's, so the list has a second page («Cargar más»
-- brings 20 at a time). Generated, two days apart from July 1, cycling through the four clients,
-- the eight statuses, the methods (never one whose route skips the status it's in) and three
-- rental days; the totals are worked out here with the formula, so they can't drift.
WITH RECURSIVE counter(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM counter WHERE i < 26),
generated AS (
	SELECT
		1010 + i AS id,
		CASE i % 4 WHEN 0 THEN '1036452118' WHEN 1 THEN '@7Q2M9KXA' WHEN 2 THEN '@4MZT7QJD' ELSE '@C5VB0PZT' END AS document_id,
		CASE i % 8 WHEN 0 THEN 'DRAFT' WHEN 1 THEN 'CONFIRMED' WHEN 2 THEN 'PICKED' WHEN 3 THEN 'OUT_FOR_DELIVERY'
			WHEN 4 THEN 'DELIVERED' WHEN 5 THEN 'OUT_FOR_PICKUP' WHEN 6 THEN 'COMPLETED' ELSE 'CANCELLED' END AS status,
		date('2026-07-01', '+' || (i * 2) || ' days') AS event_date,
		1 + i % 3 AS rental_days,
		20 + i * 5 AS chairs,
		(i % 3) * 30000 AS transport_cost,
		i % 5 = 1 AND i % 8 != 3 AS is_client_pickup,
		i % 5 = 2 AND i % 8 != 5 AS is_client_return
	FROM counter
),
priced AS (
	SELECT generated.*, chairs * 2500 * rental_days AS chairs_total, 50 * 900 * rental_days AS glasses_total
	FROM generated
)
INSERT INTO orders (id, public_token, client_id, status, event_date, delivery_date, pickup_date, rental_days, client_attributes, delivery_attributes, pickup_attributes, order_items, items_total, discount, transport_cost, order_total, deposit_amount, attributes, created_at, created_by, updated_at, updated_by)
SELECT
	priced.id, printf('00000000-0000-4000-8000-%012d', priced.id), contacts.id, priced.status,
	priced.event_date, date(priced.event_date, '-1 day'), date(priced.event_date, '+1 day'), priced.rental_days,
	json_object('name', contacts.full_name, 'phone', contacts.phone),
	CASE WHEN priced.is_client_pickup
		THEN json_object('method', 'CLIENT_PICKUP', 'time', '08:00', 'address_1', 'Calle 38a #79-18, Medellín, Colombia', 'address_2', NULL, 'carrier', NULL, 'notes', NULL)
		ELSE json_object('method', 'COMPANY_DELIVERY', 'time', '10:00', 'address_1', 'Cra 70 #44-21, Laureles', 'address_2', 'Salón de eventos, segundo piso', 'carrier', NULL, 'notes', NULL)
	END,
	CASE WHEN priced.is_client_return
		THEN json_object('method', 'CLIENT_RETURN', 'time', NULL, 'address_1', 'Calle 38a #79-18, Medellín, Colombia', 'address_2', NULL, 'carrier', NULL, 'notes', NULL)
		ELSE json_object('method', 'COMPANY_PICKUP', 'time', '16:00', 'address_1', 'Cra 70 #44-21, Laureles', 'address_2', 'Salón de eventos, segundo piso', 'carrier', NULL, 'notes', NULL)
	END,
	json_array(
		json_object('product_id', (SELECT id FROM products WHERE name = 'Silla Tiffany dorada'), 'name', 'Silla Tiffany dorada', 'qty', priced.chairs, 'list_price', 2500, 'unit_price', 2500, 'line_total', priced.chairs_total),
		json_object('product_id', (SELECT id FROM products WHERE name = 'Copa para vino tinto'), 'name', 'Copa para vino tinto', 'qty', 50, 'list_price', 900, 'unit_price', 900, 'line_total', priced.glasses_total)
	),
	priced.chairs_total + priced.glasses_total, 0, priced.transport_cost,
	priced.chairs_total + priced.glasses_total + priced.transport_cost, 50000, '{}',
	unixepoch(), 'system', unixepoch(), 'system'
FROM priced JOIN contacts ON contacts.document_id = priced.document_id
WHERE true -- SQLite reads ON CONFLICT after a SELECT only past a WHERE
ON CONFLICT (id) DO NOTHING;

-- Counts only pending or rejected: an approved or reversed one needs the events rows reversalBlock
-- and the suggested list are ordered by, so one is approved in the app to try them. #1 and #2 share
-- the Tiffany chair, so each warns of the other; #2's glasses were counted against 905, no longer
-- their 900, so the item reads «Desactualizado». Explicit ids, so a second run finds them.
INSERT INTO inventory_counts (id, status, inventory_items, review_note, reviewed_by, reviewed_at, created_at, created_by, updated_at, updated_by)
VALUES
	(1, 'PENDING_APPROVAL',
		json_array(
			json_object('product_id', (SELECT id FROM products WHERE name = 'Silla Tiffany dorada'), 'name', 'Silla Tiffany dorada', 'system_qty', 800, 'counted_qty', 796),
			json_object('product_id', (SELECT id FROM products WHERE name = 'Mantel blanco 3×3'), 'name', 'Mantel blanco 3×3', 'system_qty', 120, 'counted_qty', 118)
		),
		NULL, NULL, NULL, unixepoch(), 'system', unixepoch(), 'system'),
	(2, 'PENDING_APPROVAL',
		json_array(
			json_object('product_id', (SELECT id FROM products WHERE name = 'Silla Tiffany dorada'), 'name', 'Silla Tiffany dorada', 'system_qty', 800, 'counted_qty', 795),
			json_object('product_id', (SELECT id FROM products WHERE name = 'Copa para vino tinto'), 'name', 'Copa para vino tinto', 'system_qty', 905, 'counted_qty', 897)
		),
		NULL, NULL, NULL, unixepoch(), 'system', unixepoch(), 'system'),
	(3, 'REJECTED',
		json_array(
			json_object('product_id', (SELECT id FROM products WHERE name = 'Samovar rectangular'), 'name', 'Samovar rectangular', 'system_qty', 18, 'counted_qty', 15)
		),
		'Faltó contar los de la bodega 2: hay que contar otra vez.', 'gerente', unixepoch(), unixepoch(), 'system', unixepoch(), 'system')
ON CONFLICT (id) DO NOTHING;

-- Every concept but PAYROLL: no settlement is paid. #1043 reads as in the brief (paid $500.000, owes
-- $680.000, holds a $200.000 deposit); #1051 pays its carrier; four generated orders: an advance on
-- #1011, #1014 paid in two, #1016 paid with its deposit given back, #1017 cancelled and refunded.
-- October's standalone ones include an expense typed as $850.000, its offset and the right one.
-- `receipt_number` per sign as the cash service's INSERT works it out, each sign's highest plus one,
-- here in id order; explicit ids, so a second run finds them and `reverses_id` can name its original.
INSERT INTO cash_movements (id, concept, payment_method, amount, movement_date, entity_type, entity_id, payee, attributes, reverses_id, receipt_number, created_at, created_by, updated_at, updated_by)
SELECT column1, column2, column3, column4, column5, column6, column7, column8, column9, column10,
	(SELECT coalesce(max(receipt_number), 0) FROM cash_movements WHERE (amount > 0) = (sample.column4 > 0))
		+ row_number() OVER (PARTITION BY column4 > 0 ORDER BY column1),
	unixepoch(), 'system', unixepoch(), 'system'
FROM (VALUES
	(1, 'INSTALLMENT', 'TRANSFER', 300000, '2026-07-20', 'ORDER', 1043, 'Luz Marina Restrepo', '{"bank_account":"Bancolombia"}', NULL),
	(2, 'INSTALLMENT', 'CASH', 200000, '2026-08-14', 'ORDER', 1043, 'Luz Marina Restrepo', '{}', NULL),
	(3, 'SECURITY_DEPOSIT', 'CASH', 200000, '2026-08-14', 'ORDER', 1043, 'Luz Marina Restrepo', '{}', NULL),
	(4, 'CARRIER_PAYMENT', 'TRANSFER', -50000, '2026-08-24', 'ORDER', 1051, 'Wilson Muñoz', '{"bank_account":"Nequi 311 908 5512"}', NULL),
	(5, 'INSTALLMENT', 'CASH', 100000, '2026-06-28', 'ORDER', 1011, 'Jorge Iván Betancur', '{}', NULL),
	(6, 'INSTALLMENT', 'TRANSFER', 150000, '2026-07-05', 'ORDER', 1014, 'Luz Marina Restrepo', '{"bank_account":"Davivienda"}', NULL),
	(7, 'INSTALLMENT', 'CASH', 170000, '2026-07-08', 'ORDER', 1014, 'Luz Marina Restrepo', '{}', NULL),
	(8, 'INSTALLMENT', 'CASH', 170000, '2026-07-12', 'ORDER', 1016, 'Diana Zuluaga', '{}', NULL),
	(9, 'SECURITY_DEPOSIT', 'CASH', 50000, '2026-07-12', 'ORDER', 1016, 'Diana Zuluaga', '{}', NULL),
	(10, 'DEPOSIT_REFUND', 'CASH', -50000, '2026-07-14', 'ORDER', 1016, 'Diana Zuluaga', '{}', NULL),
	(11, 'INSTALLMENT', 'TRANSFER', 100000, '2026-07-08', 'ORDER', 1017, 'Emily Carter', '{"bank_account":"Bancolombia"}', NULL),
	(12, 'INSTALLMENT_REFUND', 'TRANSFER', -100000, '2026-07-10', 'ORDER', 1017, 'Emily Carter', '{"bank_account":"Bancolombia ahorros 031-552210-88"}', NULL),
	(13, 'OTHER_INCOME', 'CASH', 120000, '2026-10-05', NULL, NULL, 'Chatarrería El Progreso', '{"description":"Venta de sillas plásticas dadas de baja"}', NULL),
	(14, 'OTHER_EXPENSE', 'CASH', -850000, '2026-10-08', NULL, NULL, 'Ferretería Laureles', '{"description":"Bombillos y extensiones para la bodega"}', NULL),
	(15, 'OTHER_EXPENSE', 'CASH', 850000, '2026-10-08', NULL, NULL, 'Ferretería Laureles', '{"description":"Bombillos y extensiones para la bodega","notes":"El valor era $85.000"}', 14),
	(16, 'OTHER_EXPENSE', 'CASH', -85000, '2026-10-08', NULL, NULL, 'Ferretería Laureles', '{"description":"Bombillos y extensiones para la bodega"}', NULL),
	(17, 'OTHER_EXPENSE', 'TRANSFER', -320000, '2026-10-20', NULL, NULL, 'EPM', '{"description":"Servicios públicos de la bodega, septiembre","bank_account":"Convenio EPM 0045821"}', NULL)
) AS sample
WHERE NOT EXISTS (SELECT 1 FROM cash_movements WHERE cash_movements.id = sample.column1)
ORDER BY column1;
