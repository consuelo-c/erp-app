-- Default settings, 2026 and 2027 Colombian holidays and the help's first draft included. Not sample data: production needs
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
	]')),
	('HELP_FAQ', 'Bienvenido a Banquetes Consuelo C. Aquí están las respuestas a lo que más se pregunta en los primeros días: cómo se mueve un pedido, cuándo pagan los clientes, qué hacer cuando algo vuelve dañado y cómo marcar tus horas.

Toca una pregunta para abrirla. Si algo no está aquí, pregúntale al Gerente.

## ¿Qué hago al llegar?

1. Abre **Horas** y toca «Marcar» en **Inicio mañana**.
2. Abre **Despachos** mientras tienes señal. Así queda guardada en el celular la lista del día, por si luego te quedas sin internet.
3. Revisa la lista: arriba van los pedidos **atrasados**, después los del día por hora y al final los que no tienen hora.

## ¿Qué muestra Despachos?

Las entregas y recogidas de un día, de todos los métodos: las que hace la empresa, las que recoge o devuelve el cliente y las que lleva un transportador externo. Por defecto muestra hoy; con el calendario puedes ver otro día.

Cada fila dice si es entrega o recogida, la hora, el cliente, el método y la dirección o el transportador, con su estado. Un pedido que lleva días sin entregarse o sin recogerse aparece como **Atrasado**, con su fecha.

Al tocar una fila se abre el pedido: el cliente con botones para llamar, escribir por WhatsApp o abrir la dirección en Google Maps, los productos, las notas y los totales.

## ¿Cómo avanza un pedido?

Un pedido pasa por estos estados, en orden:

1. **Confirmado**: Ventas lo cerró con el cliente.
2. **Separado**: Bodega alistó los productos.
3. **En ruta de entrega**: salió hacia el cliente.
4. **Entregado**: el cliente lo recibió.
5. **En ruta de recogida**: salimos a recogerlo.
6. **Completado**: volvió a bodega.

En el detalle del pedido, el botón grande dice el siguiente paso, por ejemplo «Marcar como Separado». Te pide confirmar y **no se puede deshacer**, así que márcalo solo cuando de verdad pasó.

## ¿Por qué un pedido salta un estado?

Porque no siempre lo llevamos ni lo recogemos nosotros:

- Si **el cliente recoge** en bodega, el pedido pasa de **Separado** a **Entregado**: nunca sale en ruta de entrega.
- Si **el cliente devuelve** en bodega, pasa de **Entregado** a **Completado**: nunca sale en ruta de recogida.

El botón ya sabe cuál es el siguiente paso de cada pedido. Tú solo lo tocas.

## ¿Para qué sirve la nota al marcar un estado?

Al confirmar un estado puedes escribir una nota, por ejemplo «Recibió el celador» o «Cobré $20.000». Esa nota **reemplaza** la nota de entrega o de recogida del pedido, y la oficina la ve. Si no escribes nada, la nota anterior se queda igual.

## ¿Qué significa «Modificado después de separado»?

Que alguien cambió el pedido después de que Bodega lo alistó: pudieron cambiar productos, cantidades, la dirección o la hora. **Revisa lo separado contra el pedido** antes de que salga, y si algo no cuadra, pregunta en la oficina.

## ¿Cuándo pagan los clientes?

Cuando quieran, en las cuotas que acuerden con Ventas. No hay un anticipo obligatorio: al confirmar, el sistema solo sugiere uno como referencia.

Casi todos pagan por transferencia. **Un saldo pendiente no impide entregar**: el pedido dice «Saldo pendiente. No impide entregar.» y se entrega igual.

## ¿Qué hago si el cliente me paga a mí?

Recíbelo y escríbelo en la nota al marcar el estado, por ejemplo «Cobré $200.000 en efectivo». **El conductor no registra pagos en la app**: el pago se registra cuando el dinero llega a la oficina.

## ¿Qué es el depósito?

Es una garantía que el cliente deja y que **no hace parte del total** del pedido. Se le devuelve al final. Si algo vuelve dañado o se pierde, la oficina decide si se le devuelve completo, una parte o nada, según quién fue el responsable. Tú solo reportas lo que pasó.

## ¿Cómo reporto una novedad?

Una novedad es un producto que volvió dañado o que no volvió. En el detalle del pedido toca **«Reportar novedad»**. Aparece cuando el pedido está Entregado, En ruta de recogida o Completado.

1. Toca «Agregar producto del pedido» por cada producto afectado.
2. Ajusta la cantidad con − y +.
3. Elige el resultado: **Perdido**, **Inservible** o **Recuperable**.
4. Escribe una descripción de lo que pasó. Es obligatoria.
5. Toca «Guardar novedad» y confirma.

El responsable queda «Por determinar»: lo decide la oficina. Si te equivocaste, avísale al Gerente, que puede revertirla.

## ¿Recuperable, perdido o inservible?

- **Perdido**: no volvió. Se descuenta del inventario.
- **Inservible**: volvió, pero ya no se puede alquilar, por ejemplo una copa rota. Se descuenta del inventario.
- **Recuperable**: volvió con un daño que se arregla, por ejemplo un mantel manchado o una silla con la pata floja. **No se descuenta**: se lava o se repara y vuelve a estar disponible.

Si un mismo producto volvió de dos formas, agrégalo dos veces: por ejemplo, 4 sillas perdidas y 3 recuperables en la misma novedad.

## ¿Cómo hago un conteo físico?

En **Inventario › Conteo físico**:

1. Escribe en cada producto **el total de la empresa**: lo que hay en bodega más lo que está en alquiler. Cada fila te muestra lo que dice el sistema y lo que está en alquiler, para que compares.
2. Para contar un producto que no está en la lista, búscalo en «Buscar otro producto».
3. Lo que dejes en blanco no se cuenta. Cada variante cuenta por separado: las sillas blancas y las doradas son dos productos.
4. Toca «Enviar para aprobación» y confirma.

Después de enviarlo no se puede editar. El inventario cambia cuando el Gerente o el Administrador lo aprueba.

## ¿Qué es la lista de sugeridos?

Son los productos que volvieron como **Recuperables** en una novedad y que nadie ha contado desde entonces. Cada uno dice cuántas unidades y de qué pedidos. Cuéntalos cuando ya estén lavados o reparados: así la empresa sabe que volvieron a estar disponibles.

## ¿Qué pasa si me quedo sin señal?

Despachos abre sin internet **si lo abriste hoy con señal**: muestra lo que guardó en ese momento, con el aviso «Sin señal · Datos de las …». Puedes ver la lista y el detalle de cada pedido, pero **no puedes marcar estados ni reportar novedades**.

Cuando vuelvas a tener señal o llegues a la oficina, marca lo que pasó. Los datos de otro día no se muestran: si no abriste Despachos hoy, sin señal no hay nada que ver. Las demás pantallas necesitan internet.

## ¿Cómo marco mis horas?

En **Horas** ves el día de hoy y tu semana. Cada día tiene cuatro marcas: **Inicio mañana**, **Finalización mañana**, **Inicio tarde** y **Finalización tarde**.

Toca «Marcar», revisa la hora y toca «Guardar». Marca cada una cuando pase: al llegar, al salir a almorzar, al volver y al irte.

## ¿Y si me equivoqué o se me olvidó marcar?

- Para **corregir** una marca, tócala y cambia la hora.
- Para un **día anterior**, tócalo en la semana y agrega las marcas que faltan.
- Si marcaste un día que no trabajaste, usa «Borrar marcas del día».

Cuando la semana ya se pagó en la nómina, sus días no se pueden cambiar. Si hay un error en una semana pagada, avísale al Gerente.')
)
WHERE true -- Lets SQLite parse ON CONFLICT after a SELECT.
ON CONFLICT(key) DO NOTHING;
