-- Sample data, development only: the Design Brief's products, a few contacts, five employees, a login
-- per role on four of them, their punches from 10 to 18 October 2026, forty-five orders between 1 and
-- 18 October (the brief's three among them), three counts, and the orders' and standalone cash movements.
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
	('573006152290', 'Diana Zuluaga', '@4MZT7QJD', '[]', '{"address_1":"Calle 10 Sur #50-120, El Poblado","address_2":"Club Campestre Las Palmas, salón Orquídea"}'),
	('573128904417', 'Carolina Gómez Vélez', '1152203874', '[]', '{"address_1":"Cra 81 #34-56, Belén","address_2":"Unidad Altos del Rodeo, salón comunal"}'),
	('573046671230', 'Salón de Eventos Villa Fernanda', '9013345781', '[]', '{"email":"eventos@villafernanda.com.co","address_1":"Km 4 vía Las Palmas","address_2":"Salón de Eventos Villa Fernanda, parqueadero 2"}'),
	('573215508842', 'Andrés Felipe Cano', '@8KDN4TWR', '[]', '{}'),
	('573017733905', 'Colegio Monte Verde', '8909041236', '[]', '{"address_1":"Calle 2 Sur #25-40, El Poblado","address_2":"Entrada por el coliseo"}'),
	('573164420981', 'Beatriz Elena Ochoa', '42889016', '[]', '{"address_1":"Vereda El Chuscal km 3, Envigado","address_2":"Finca Villa Carmen, portón blanco después del puente"}'),
	('573105549217', 'Juan Camilo Arbeláez', '@2RXF6HMB', '[]', '{"address_1":"Cra 45 #75 Sur-30, Sabaneta","address_2":"Casa 14, conjunto Cañaveral"}'),
	('573122268804', 'Hernán Darío Zapata', '15387620', '["TRANSPORTER"]', '{"bank_account":"Bancolombia ahorros 245-118903-41"}'),
	('573137724518', 'Sebastián Mejía', '1017234590', '["WAITER"]', '{"bank_account":"Nequi 313 772 4518","notes":"Trae su propio uniforme"}'),
	('573158841203', 'Valentina Arango', '1037619844', '["WEDDING_PLANNER"]', '{"email":"valentina@arangoeventos.co"}'),
	('573176630492', 'Mateo Londoño', '1020456781', '["BARTENDER","BARISTA"]', '{"notes":"Coctelería y estación de café"}'),
	('573189952074', 'Natalia Cardona', '43987125', '["BARISTA"]', '{}')
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

-- Forty-five orders, every delivery and pickup from Thursday 1 to Sunday 18 October 2026, their
-- statuses read as if today were Wednesday 14: picked up before it `COMPLETED`, out with the client
-- across it `DELIVERED`, its own trips somewhere along the way, after it `CONFIRMED` or `DRAFT`, and a
-- few `CANCELLED`. The Design Brief's #1043 and #1051 keep their weekdays, #1047 is `DELIVERED` to try
-- editing and an extension. Busiest Friday to Sunday; the 12th's holiday has trips, #1043 and #1031
-- deliver at the same date and time, and #1039 would overbook the chairs on the 17th if confirmed, so
-- each warning shows. The confirmed ones never overbook. Explicit ids and fixed tokens, so a second
-- run finds them. Clients, carriers and products are looked up by document and name, never by a
-- rowid another seed run may have moved. Each line is `[name, qty]`, priced here from the catalog
-- with the formula, so the totals can't drift; a client's own trip is at the company's address.
WITH venues (venue, address_1, address_2) AS (VALUES
	('torre-verde', 'Cra 43A #18-95, El Poblado', 'Salón Social Torre Verde, piso 2'),
	('las-palmas', 'Calle 10 Sur #50-120, El Poblado', 'Club Campestre Las Palmas, salón Orquídea'),
	('laureles', 'Calle 49 #70-35, Laureles', 'Casa de dos pisos, reja negra'),
	('salon-laureles', 'Cra 70 #44-21, Laureles', 'Salón de eventos, segundo piso'),
	('chuscal', 'Vereda El Chuscal km 3, Envigado', 'Finca Villa Carmen, portón blanco después del puente'),
	('rodeo', 'Cra 81 #34-56, Belén', 'Unidad Altos del Rodeo, salón comunal'),
	('villa-fernanda', 'Km 4 vía Las Palmas', 'Salón de Eventos Villa Fernanda, parqueadero 2'),
	('colegio', 'Calle 2 Sur #25-40, El Poblado', 'Colegio Monte Verde, entrada por el coliseo'),
	('sabaneta', 'Cra 45 #75 Sur-30, Sabaneta', 'Casa 14, conjunto Cañaveral'),
	('estadio', 'Cra 74 #48-10, Estadio', 'Apartamento 502, torre 3')
),
sample (id, token, document_id, status, event_date, venue, rental_days, discount, transport_cost, deposit_amount,
	delivery_date, delivery_method, delivery_time, delivery_carrier, pickup_date, pickup_method, pickup_time, pickup_carrier, lines, notes) AS (VALUES
	(1001, NULL, '1036452118', 'COMPLETED', '2026-10-02', 'torre-verde', 1, 0, 120000, 100000,
		'2026-10-01', 'COMPANY_DELIVERY', '15:00', NULL, '2026-10-03', 'COMPANY_PICKUP', '10:00', NULL,
		'[["Silla Tiffany dorada",50],["Mesa redonda 10 puestos",5],["Mantel blanco 3×3",5]]', NULL),
	(1002, NULL, '@2RXF6HMB', 'COMPLETED', '2026-10-03', 'sabaneta', 1, 0, 60000, 50000,
		'2026-10-02', 'COMPANY_DELIVERY', '09:00', NULL, '2026-10-04', 'COMPANY_PICKUP', '16:00', NULL,
		'[["Silla Tiffany dorada",40],["Plato pando 26cm",40],["Tenedor de mesa",40],["Copa para vino tinto",40]]', NULL),
	(1003, NULL, '9013345781', 'COMPLETED', '2026-10-03', 'villa-fernanda', 2, 150000, 220000, 200000,
		'2026-10-02', 'EXTERNAL_CARRIER', '14:00', '98552017', '2026-10-05', 'EXTERNAL_CARRIER', '08:00', '98552017',
		'[["Silla Tiffany dorada",150],["Mesa redonda 10 puestos",15],["Mantel blanco 3×3",15],["Copa para vino tinto",150],["Candelabro de piso 5 brazos",6]]',
		'Montar antes de las 5 p.m.: el salón cierra el portón a las 6.'),
	(1004, NULL, '@C5VB0PZT', 'CANCELLED', '2026-10-03', 'estadio', 1, 0, 60000, 50000,
		'2026-10-02', 'COMPANY_DELIVERY', '16:00', NULL, '2026-10-04', 'COMPANY_PICKUP', '11:00', NULL,
		'[["Silla Tiffany dorada",30],["Copa para vino tinto",30],["Mantel cuadrado 50×50 — Azul",4]]', NULL),
	(1005, NULL, '@8KDN4TWR', 'COMPLETED', '2026-10-04', 'salon-laureles', 1, 0, 0, 0,
		'2026-10-03', 'CLIENT_PICKUP', '08:00', NULL, '2026-10-05', 'CLIENT_RETURN', NULL, NULL,
		'[["Silla Tiffany dorada",30],["Mantel cuadrado 50×50 — Rojo",6]]', NULL),
	(1006, NULL, '42889016', 'COMPLETED', '2026-10-03', 'chuscal', 1, 0, 150000, 100000,
		'2026-10-02', 'COMPANY_DELIVERY', '11:00', NULL, '2026-10-04', 'COMPANY_PICKUP', '09:00', NULL,
		'[["Silla Tiffany dorada",80],["Mesa redonda 10 puestos",8],["Mantel cuadrado 50×50 — Dorado",8],["Samovar rectangular",3]]',
		'En la finca no hay señal: llamar desde el puente.'),
	(1007, NULL, '8909041236', 'COMPLETED', '2026-10-07', 'colegio', 1, 100000, 80000, 0,
		'2026-10-06', 'COMPANY_DELIVERY', '07:00', NULL, '2026-10-07', 'COMPANY_PICKUP', '17:00', NULL,
		'[["Silla Tiffany dorada",200],["Mesa redonda 10 puestos",20]]', 'Día de la familia. Entregar en portería a la coordinadora.'),
	(1008, NULL, '@4MZT7QJD', 'COMPLETED', '2026-10-09', 'las-palmas', 1, 0, 90000, 100000,
		'2026-10-08', 'COMPANY_DELIVERY', '10:00', NULL, '2026-10-10', 'COMPANY_PICKUP', '09:00', NULL,
		'[["Silla Tiffany dorada",60],["Samovar rectangular",4],["Plato pando 26cm",60],["Tenedor de mesa",60]]', NULL),
	(1009, NULL, '1152203874', 'COMPLETED', '2026-10-10', 'rodeo', 2, 0, 80000, 100000,
		'2026-10-09', 'COMPANY_DELIVERY', '14:00', NULL, '2026-10-11', 'COMPANY_PICKUP', '10:00', NULL,
		'[["Silla Tiffany dorada",70],["Mesa redonda 10 puestos",7],["Mantel cuadrado 50×50 — Verde",7],["Copa para vino tinto",70]]', NULL),
	(1010, NULL, '@7Q2M9KXA', 'COMPLETED', '2026-10-10', 'laureles', 2, 0, 0, 50000,
		'2026-10-09', 'CLIENT_PICKUP', '08:00', NULL, '2026-10-12', 'CLIENT_RETURN', NULL, NULL,
		'[["Silla Tiffany dorada",40],["Mantel blanco 3×3",4]]', NULL),
	(1011, NULL, '9013345781', 'COMPLETED', '2026-10-10', 'villa-fernanda', 2, 200000, 220000, 200000,
		'2026-10-09', 'EXTERNAL_CARRIER', '15:00', '15387620', '2026-10-11', 'EXTERNAL_CARRIER', '08:00', '15387620',
		'[["Silla Tiffany dorada",180],["Mesa redonda 10 puestos",18],["Mantel blanco 3×3",18],["Copa para vino tinto",180],["Tenedor de mesa",180],["Plato pando 26cm",180],["Candelabro de piso 5 brazos",8]]', NULL),
	(1012, NULL, '1036452118', 'COMPLETED', '2026-10-10', 'torre-verde', 1, 0, 120000, 50000,
		'2026-10-10', 'COMPANY_DELIVERY', '08:00', NULL, '2026-10-11', 'COMPANY_PICKUP', '18:00', NULL,
		'[["Silla Tiffany dorada",40],["Copa para vino tinto",40]]', NULL),
	(1013, NULL, '42889016', 'CANCELLED', '2026-10-11', 'chuscal', 1, 0, 150000, 100000,
		'2026-10-10', 'COMPANY_DELIVERY', '10:00', NULL, '2026-10-12', 'COMPANY_PICKUP', '10:00', NULL,
		'[["Silla Tiffany dorada",60],["Mesa redonda 10 puestos",6]]', NULL),
	(1014, NULL, '@8KDN4TWR', 'COMPLETED', '2026-10-11', 'salon-laureles', 1, 0, 60000, 50000,
		'2026-10-10', 'COMPANY_DELIVERY', '16:00', NULL, '2026-10-12', 'COMPANY_PICKUP', '09:00', NULL,
		'[["Silla Tiffany dorada",50],["Mantel cuadrado 50×50 — Azul",5],["Copa para vino tinto",50]]', NULL),
	(1015, NULL, '@2RXF6HMB', 'COMPLETED', '2026-10-12', 'sabaneta', 1, 0, 60000, 50000,
		'2026-10-11', 'COMPANY_DELIVERY', '15:00', NULL, '2026-10-13', 'COMPANY_PICKUP', '10:00', NULL,
		'[["Silla Tiffany dorada",30],["Plato pando 26cm",30],["Tenedor de mesa",30]]', NULL),
	(1016, NULL, '@C5VB0PZT', 'COMPLETED', '2026-10-11', 'estadio', 1, 0, 0, 0,
		'2026-10-10', 'CLIENT_PICKUP', '09:00', NULL, '2026-10-12', 'CLIENT_RETURN', NULL, NULL,
		'[["Silla Tiffany dorada",20],["Copa para vino tinto",20]]', NULL),
	(1017, NULL, '1152203874', 'DELIVERED', '2026-10-10', 'rodeo', 3, 0, 80000, 100000,
		'2026-10-09', 'COMPANY_DELIVERY', '11:00', NULL, '2026-10-15', 'COMPANY_PICKUP', '10:00', NULL,
		'[["Silla Tiffany dorada",40],["Mesa redonda 10 puestos",4],["Mantel blanco 3×3",4]]',
		'Primera comunión el sábado y almuerzo familiar el miércoles: se quedan toda la semana.'),
	(1018, NULL, '8909041236', 'COMPLETED', '2026-10-13', 'colegio', 1, 0, 80000, 0,
		'2026-10-12', 'COMPANY_DELIVERY', '15:00', NULL, '2026-10-13', 'COMPANY_PICKUP', '17:00', NULL,
		'[["Silla Tiffany dorada",120],["Mesa redonda 10 puestos",12],["Samovar rectangular",6]]', NULL),
	(1019, NULL, '@7Q2M9KXA', 'DELIVERED', '2026-10-14', 'laureles', 2, 0, 60000, 50000,
		'2026-10-13', 'COMPANY_DELIVERY', '09:00', NULL, '2026-10-15', 'COMPANY_PICKUP', NULL, NULL,
		'[["Silla Tiffany dorada",30],["Mesa redonda 10 puestos",3],["Mantel cuadrado 50×50 — Rojo",3]]', NULL),
	(1047, '9a6e4d21-5b7c-4f3e-8a1d-2c4b6e8f1047', '@4MZT7QJD', 'DELIVERED', '2026-10-14', 'las-palmas', 2, 0, 220000, 150000,
		'2026-10-13', 'EXTERNAL_CARRIER', '14:00', '98552017', '2026-10-16', 'EXTERNAL_CARRIER', '09:00', '98552017',
		'[["Silla Tiffany dorada",100],["Mesa redonda 10 puestos",10],["Copa para vino tinto",100]]', 'Montaje en la terraza del salón.'),
	(1020, NULL, '42889016', 'DELIVERED', '2026-10-15', 'chuscal', 1, 0, 150000, 100000,
		'2026-10-14', 'COMPANY_DELIVERY', '08:00', NULL, '2026-10-16', 'COMPANY_PICKUP', '10:00', NULL,
		'[["Silla Tiffany dorada",40],["Mesa redonda 10 puestos",4],["Mantel cuadrado 50×50 — Verde",4],["Candelabro de piso 5 brazos",4]]', NULL),
	(1021, NULL, '@8KDN4TWR', 'OUT_FOR_DELIVERY', '2026-10-14', 'salon-laureles', 1, 0, 60000, 50000,
		'2026-10-14', 'COMPANY_DELIVERY', '11:00', NULL, '2026-10-16', 'COMPANY_PICKUP', '11:00', NULL,
		'[["Silla Tiffany dorada",40],["Copa para vino tinto",40],["Plato pando 26cm",40]]', NULL),
	(1022, NULL, '9013345781', 'PICKED', '2026-10-16', 'villa-fernanda', 3, 0, 220000, 200000,
		'2026-10-14', 'EXTERNAL_CARRIER', '15:00', '15387620', '2026-10-17', 'EXTERNAL_CARRIER', '09:00', '15387620',
		'[["Silla Tiffany dorada",100],["Mesa redonda 10 puestos",10],["Mantel blanco 3×3",10],["Copa para vino tinto",100],["Samovar rectangular",4]]', NULL),
	(1023, NULL, '8909041236', 'CONFIRMED', '2026-10-15', 'colegio', 1, 0, 80000, 0,
		'2026-10-14', 'COMPANY_DELIVERY', '16:00', NULL, '2026-10-15', 'COMPANY_PICKUP', '14:00', NULL,
		'[["Silla Tiffany dorada",100],["Mesa redonda 10 puestos",10]]', NULL),
	(1024, NULL, '@C5VB0PZT', 'PICKED', '2026-10-15', 'estadio', 1, 0, 0, 30000,
		'2026-10-14', 'CLIENT_PICKUP', '17:00', NULL, '2026-10-15', 'CLIENT_RETURN', NULL, NULL,
		'[["Silla Tiffany dorada",24],["Mantel cuadrado 50×50 — Azul",4],["Copa para vino tinto",24]]', NULL),
	(1025, NULL, '1152203874', 'COMPLETED', '2026-10-13', 'rodeo', 1, 0, 80000, 50000,
		'2026-10-12', 'COMPANY_DELIVERY', '10:00', NULL, '2026-10-14', 'COMPANY_PICKUP', '08:00', NULL,
		'[["Silla Tiffany dorada",30],["Copa para vino tinto",30]]', NULL),
	(1026, NULL, '@2RXF6HMB', 'OUT_FOR_PICKUP', '2026-10-13', 'sabaneta', 1, 0, 60000, 50000,
		'2026-10-13', 'COMPANY_DELIVERY', '08:00', NULL, '2026-10-14', 'COMPANY_PICKUP', '10:00', NULL,
		'[["Silla Tiffany dorada",40],["Plato pando 26cm",40],["Tenedor de mesa",40]]', NULL),
	(1027, NULL, '@4MZT7QJD', 'DELIVERED', '2026-10-13', 'las-palmas', 1, 0, 90000, 50000,
		'2026-10-13', 'COMPANY_DELIVERY', '16:00', NULL, '2026-10-14', 'COMPANY_PICKUP', '15:00', NULL,
		'[["Silla Tiffany dorada",50],["Mantel cuadrado 50×50 — Dorado",5],["Mesa redonda 10 puestos",5]]', NULL),
	(1028, NULL, '1036452118', 'DELIVERED', '2026-10-11', 'torre-verde', 2, 0, 0, 50000,
		'2026-10-10', 'CLIENT_PICKUP', '09:00', NULL, '2026-10-14', 'CLIENT_RETURN', NULL, NULL,
		'[["Silla Tiffany dorada",30],["Copa para vino tinto",30]]', NULL),
	(1051, '5d2b8f16-0e3a-4b7c-9d4f-6a8c0e2b1051', '@7Q2M9KXA', 'DRAFT', '2026-10-17', 'laureles', 2, 44000, 60000, 100000,
		'2026-10-15', 'CLIENT_PICKUP', '08:00', NULL, '2026-10-18', 'EXTERNAL_CARRIER', '09:00', '98552017',
		'[["Silla Tiffany dorada",60],["Mesa redonda 10 puestos",6]]', 'Recoge en camioneta propia.'),
	(1029, NULL, '42889016', 'PICKED', '2026-10-16', 'chuscal', 2, 0, 150000, 100000,
		'2026-10-15', 'COMPANY_DELIVERY', '09:00', NULL, '2026-10-17', 'COMPANY_PICKUP', '10:00', NULL,
		'[["Silla Tiffany dorada",70],["Mesa redonda 10 puestos",6],["Mantel blanco 3×3",6],["Samovar rectangular",2]]', NULL),
	(1030, NULL, '@8KDN4TWR', 'CONFIRMED', '2026-10-15', 'salon-laureles', 1, 0, 60000, 50000,
		'2026-10-15', 'COMPANY_DELIVERY', '14:00', NULL, '2026-10-16', 'COMPANY_PICKUP', '16:00', NULL,
		'[["Silla Tiffany dorada",30],["Mantel cuadrado 50×50 — Rojo",3]]', NULL),
	(1043, '3f1c2b7a-8d4e-4c1a-9b2f-0a1d5e7c1043', '1036452118', 'CONFIRMED', '2026-10-17', 'torre-verde', 2, 104000, 180000, 200000,
		'2026-10-16', 'COMPANY_DELIVERY', '14:00', NULL, '2026-10-18', 'COMPANY_PICKUP', '09:00', NULL,
		'[["Silla Tiffany dorada",120],["Mesa redonda 10 puestos",12],["Copa para vino tinto",120]]',
		'Entrar por el portón de servicio. Llamar 30 minutos antes de llegar.'),
	(1031, NULL, '1152203874', 'CONFIRMED', '2026-10-17', 'rodeo', 1, 0, 80000, 100000,
		'2026-10-16', 'COMPANY_DELIVERY', '14:00', NULL, '2026-10-18', 'COMPANY_PICKUP', '12:00', NULL,
		'[["Silla Tiffany dorada",80],["Mesa redonda 10 puestos",6],["Mantel blanco 3×3",6]]', NULL),
	(1032, NULL, '9013345781', 'CONFIRMED', '2026-10-17', 'villa-fernanda', 2, 250000, 250000, 200000,
		'2026-10-16', 'EXTERNAL_CARRIER', '10:00', '15387620', '2026-10-18', 'EXTERNAL_CARRIER', '08:00', '98552017',
		'[["Silla Tiffany dorada",150],["Mesa redonda 10 puestos",12],["Mantel blanco 3×3",12],["Copa para vino tinto",150],["Candelabro de piso 5 brazos",10]]', NULL),
	(1033, NULL, '@C5VB0PZT', 'DRAFT', '2026-10-17', 'estadio', 1, 0, 60000, 50000,
		'2026-10-16', 'COMPANY_DELIVERY', '16:00', NULL, '2026-10-17', 'COMPANY_PICKUP', '18:00', NULL,
		'[["Silla Tiffany dorada",20],["Copa para vino tinto",20]]', NULL),
	(1034, NULL, '8909041236', 'CONFIRMED', '2026-10-16', 'colegio', 1, 0, 40000, 0,
		'2026-10-16', 'COMPANY_DELIVERY', '08:00', NULL, '2026-10-17', 'CLIENT_RETURN', NULL, NULL,
		'[["Silla Tiffany dorada",60]]', 'Devuelven ellos mismos en la camioneta del colegio.'),
	(1035, NULL, '@2RXF6HMB', 'CONFIRMED', '2026-10-17', 'sabaneta', 1, 0, 60000, 50000,
		'2026-10-17', 'COMPANY_DELIVERY', '08:00', NULL, '2026-10-18', 'COMPANY_PICKUP', '17:00', NULL,
		'[["Silla Tiffany dorada",40],["Plato pando 26cm",40],["Tenedor de mesa",40],["Copa para vino tinto",40]]', NULL),
	(1036, NULL, '@4MZT7QJD', 'DRAFT', '2026-10-18', 'las-palmas', 1, 0, 0, 0,
		'2026-10-17', 'CLIENT_PICKUP', '10:00', NULL, '2026-10-18', 'CLIENT_RETURN', NULL, NULL,
		'[["Silla Tiffany dorada",30],["Mantel cuadrado 50×50 — Verde",3]]', NULL),
	(1037, NULL, '42889016', 'CONFIRMED', '2026-10-17', 'chuscal', 1, 0, 150000, 100000,
		'2026-10-17', 'COMPANY_DELIVERY', '11:00', NULL, '2026-10-18', 'COMPANY_PICKUP', '16:00', NULL,
		'[["Silla Tiffany dorada",60],["Mesa redonda 10 puestos",6],["Samovar rectangular",2]]', NULL),
	(1038, NULL, '@8KDN4TWR', 'CANCELLED', '2026-10-17', 'salon-laureles', 1, 0, 60000, 50000,
		'2026-10-17', 'COMPANY_DELIVERY', '09:00', NULL, '2026-10-18', 'COMPANY_PICKUP', '10:00', NULL,
		'[["Silla Tiffany dorada",50],["Copa para vino tinto",50]]', NULL),
	(1039, NULL, '1036452118', 'DRAFT', '2026-10-17', 'torre-verde', 1, 0, 220000, 100000,
		'2026-10-17', 'EXTERNAL_CARRIER', '13:00', '98552017', '2026-10-18', 'EXTERNAL_CARRIER', '15:00', '98552017',
		'[["Silla Tiffany dorada",150],["Copa para vino tinto",150]]', NULL),
	(1040, NULL, '1152203874', 'DRAFT', '2026-10-18', 'rodeo', 1, 0, 80000, 50000,
		'2026-10-18', 'COMPANY_DELIVERY', '09:00', NULL, '2026-10-18', 'COMPANY_PICKUP', '19:00', NULL,
		'[["Silla Tiffany dorada",40],["Mantel blanco 3×3",4]]', NULL),
	(1041, NULL, '9013345781', 'CONFIRMED', '2026-10-18', 'villa-fernanda', 1, 0, 220000, 100000,
		'2026-10-18', 'COMPANY_DELIVERY', '10:00', NULL, '2026-10-18', 'COMPANY_PICKUP', '20:00', NULL,
		'[["Silla Tiffany dorada",100],["Mesa redonda 10 puestos",10],["Copa para vino tinto",100]]', NULL),
	(1042, NULL, '@C5VB0PZT', 'DRAFT', '2026-10-18', 'estadio', 1, 0, 0, 0,
		'2026-10-18', 'CLIENT_PICKUP', '11:00', NULL, '2026-10-18', 'CLIENT_RETURN', NULL, NULL,
		'[["Silla Tiffany dorada",16],["Copa para vino tinto",16]]', NULL)
),
priced AS (
	SELECT sample.*, (
		SELECT json_group_array(json(line)) FROM (
			SELECT json_object('product_id', products.id, 'name', products.name, 'qty', line.value ->> 1,
				'list_price', products.rental_price, 'unit_price', products.rental_price,
				'line_total', (line.value ->> 1) * products.rental_price * sample.rental_days) AS line
			FROM json_each(sample.lines) AS line JOIN products ON products.name = line.value ->> 0
			ORDER BY line.key
		)
	) AS order_items
	FROM sample
),
totalled AS (
	SELECT priced.*, (SELECT sum(value ->> 'line_total') FROM json_each(order_items)) AS items_total
	FROM priced
)
INSERT INTO orders (id, public_token, client_id, status, event_date, delivery_date, pickup_date, rental_days, client_attributes, delivery_attributes, pickup_attributes, order_items, items_total, discount, transport_cost, order_total, deposit_amount, attributes, created_at, created_by, updated_at, updated_by)
SELECT
	totalled.id, coalesce(totalled.token, printf('00000000-0000-4000-8000-%012d', totalled.id)), contacts.id, totalled.status,
	totalled.event_date, totalled.delivery_date, totalled.pickup_date, totalled.rental_days,
	json_object('name', contacts.full_name, 'phone', contacts.phone),
	json_object('method', totalled.delivery_method, 'time', totalled.delivery_time,
		'address_1', iif('CLIENT_PICKUP' = totalled.delivery_method, 'Calle 38a #79-18, Medellín, Colombia', venues.address_1),
		'address_2', iif('CLIENT_PICKUP' = totalled.delivery_method, NULL, venues.address_2),
		'carrier', json((SELECT json_object('id', id, 'name', full_name, 'phone', phone) FROM contacts WHERE document_id = totalled.delivery_carrier)),
		'notes', NULL),
	json_object('method', totalled.pickup_method, 'time', totalled.pickup_time,
		'address_1', iif('CLIENT_RETURN' = totalled.pickup_method, 'Calle 38a #79-18, Medellín, Colombia', venues.address_1),
		'address_2', iif('CLIENT_RETURN' = totalled.pickup_method, NULL, venues.address_2),
		'carrier', json((SELECT json_object('id', id, 'name', full_name, 'phone', phone) FROM contacts WHERE document_id = totalled.pickup_carrier)),
		'notes', NULL),
	totalled.order_items, totalled.items_total, totalled.discount, totalled.transport_cost,
	totalled.items_total - totalled.discount + totalled.transport_cost, totalled.deposit_amount,
	iif(totalled.notes IS NULL, '{}', json_object('notes', totalled.notes)),
	unixepoch(), 'system', unixepoch(), 'system'
FROM totalled
JOIN contacts ON contacts.document_id = totalled.document_id
JOIN venues ON venues.venue = totalled.venue
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
-- $680.000, holds a $200.000 deposit); #1051 pays its carrier; four more orders: an advance on
-- #1035, #1009 paid in two, #1012 paid with its deposit given back, #1004 cancelled and refunded.
-- October's standalone ones include an expense typed as $850.000, its offset and the right one.
-- `receipt_number` per sign as the cash service's INSERT works it out, each sign's highest plus one,
-- here in id order; explicit ids, so a second run finds them and `reverses_id` can name its original.
INSERT INTO cash_movements (id, concept, payment_method, amount, movement_date, entity_type, entity_id, payee, attributes, reverses_id, receipt_number, created_at, created_by, updated_at, updated_by)
SELECT column1, column2, column3, column4, column5, column6, column7, column8, column9, column10,
	(SELECT coalesce(max(receipt_number), 0) FROM cash_movements WHERE (amount > 0) = (sample.column4 > 0))
		+ row_number() OVER (PARTITION BY column4 > 0 ORDER BY column1),
	unixepoch(), 'system', unixepoch(), 'system'
FROM (VALUES
	(1, 'INSTALLMENT', 'TRANSFER', 300000, '2026-09-22', 'ORDER', 1043, 'Luz Marina Restrepo', '{"bank_account":"Bancolombia"}', NULL),
	(2, 'INSTALLMENT', 'CASH', 200000, '2026-10-13', 'ORDER', 1043, 'Luz Marina Restrepo', '{}', NULL),
	(3, 'SECURITY_DEPOSIT', 'CASH', 200000, '2026-10-13', 'ORDER', 1043, 'Luz Marina Restrepo', '{}', NULL),
	(4, 'CARRIER_PAYMENT', 'TRANSFER', -50000, '2026-10-13', 'ORDER', 1051, 'Wilson Muñoz', '{"bank_account":"Nequi 311 908 5512"}', NULL),
	(5, 'INSTALLMENT', 'CASH', 100000, '2026-10-08', 'ORDER', 1035, 'Juan Camilo Arbeláez', '{}', NULL),
	(6, 'INSTALLMENT', 'TRANSFER', 400000, '2026-10-02', 'ORDER', 1009, 'Carolina Gómez Vélez', '{"bank_account":"Davivienda"}', NULL),
	(7, 'INSTALLMENT', 'CASH', 436000, '2026-10-09', 'ORDER', 1009, 'Carolina Gómez Vélez', '{}', NULL),
	(8, 'INSTALLMENT', 'CASH', 256000, '2026-10-10', 'ORDER', 1012, 'Luz Marina Restrepo', '{}', NULL),
	(9, 'SECURITY_DEPOSIT', 'CASH', 50000, '2026-10-10', 'ORDER', 1012, 'Luz Marina Restrepo', '{}', NULL),
	(10, 'DEPOSIT_REFUND', 'CASH', -50000, '2026-10-13', 'ORDER', 1012, 'Luz Marina Restrepo', '{}', NULL),
	(11, 'INSTALLMENT', 'TRANSFER', 100000, '2026-09-25', 'ORDER', 1004, 'Emily Carter', '{"bank_account":"Bancolombia"}', NULL),
	(12, 'INSTALLMENT_REFUND', 'TRANSFER', -100000, '2026-10-01', 'ORDER', 1004, 'Emily Carter', '{"bank_account":"Bancolombia ahorros 031-552210-88"}', NULL),
	(13, 'OTHER_INCOME', 'CASH', 120000, '2026-10-05', NULL, NULL, 'Chatarrería El Progreso', '{"description":"Venta de sillas plásticas dadas de baja"}', NULL),
	(14, 'OTHER_EXPENSE', 'CASH', -850000, '2026-10-08', NULL, NULL, 'Ferretería Laureles', '{"description":"Bombillos y extensiones para la bodega"}', NULL),
	(15, 'OTHER_EXPENSE', 'CASH', 850000, '2026-10-08', NULL, NULL, 'Ferretería Laureles', '{"description":"Bombillos y extensiones para la bodega","notes":"El valor era $85.000"}', 14),
	(16, 'OTHER_EXPENSE', 'CASH', -85000, '2026-10-08', NULL, NULL, 'Ferretería Laureles', '{"description":"Bombillos y extensiones para la bodega"}', NULL),
	(17, 'OTHER_EXPENSE', 'TRANSFER', -320000, '2026-10-20', NULL, NULL, 'EPM', '{"description":"Servicios públicos de la bodega, septiembre","bank_account":"Convenio EPM 0045821"}', NULL)
) AS sample
WHERE NOT EXISTS (SELECT 1 FROM cash_movements WHERE cash_movements.id = sample.column1)
ORDER BY column1;
