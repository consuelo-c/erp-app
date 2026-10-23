-- Sample data, development only: the Design Brief's products and a few contacts. `npm run db:seed`
-- loads it into the local D1 after settings-defaults.sql; deploy.yml never applies it. Idempotent:
-- a product whose name exists, or a contact whose document exists, is skipped. Writes no events row.
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
	('13055550142', 'Emily Carter', '@C5VB0PZT', '[]', '{"email":"emily.carter@example.com"}')
) AS sample
WHERE true -- SQLite reads ON CONFLICT after a SELECT only past a WHERE
ON CONFLICT (document_id) DO NOTHING;
