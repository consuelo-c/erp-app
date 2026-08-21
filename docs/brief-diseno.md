# Brief de diseño — App de Pedidos, Banquetes Consuelo C

Documento para **Claude Design**. Describe qué diseñar y bajo qué restricciones. La especificación técnica vive aparte, en `01-Planeacion-Aplicacion-Pedidos-v4.md`, y no hace falta leerla para diseñar.

---

## 1. Qué es esto

Herramienta **interna** de Banquetes Consuelo C, empresa de Medellín que alquila menaje para eventos (matrimonios, quinces, fiestas empresariales).

La usan **5 personas**. No es un producto público, no hay registro, no hay onboarding, no hay página de marketing. Todos los usuarios entran todos los días y conocen el sistema. **Optimizar para velocidad y para uso repetido, no para descubribilidad.**

Cubre siete cosas: toma de pedidos, planeación de despachos, registro de pagos, inventario, novedades de pedido, registro de horas trabajadas y **liquidación de nómina** — esta última es, de hecho, la pantalla ★★ más importante del módulo de Gerente/Admin (ver punto 23 en la sección 5).

---

## 2. La restricción que define todo: móvil primero

**La app se usa principalmente desde teléfono.** El escritorio solo importa para la pantalla de toma de pedidos, y ahí es la misma interfaz con campos más anchos — no un diseño distinto.

Quiénes la usan y dónde:

| Perfil | Dónde | Condiciones |
|---|---|---|
| **Conductor** | En la calle, en el camión | Sol directo, de pie, apurado, a veces con una mano |
| **Bodega** | En la bodega | Iluminación irregular, manos ocupadas, toma fotos |
| **Ventas** | Oficina o casa | Al teléfono con el cliente, escribiendo mientras habla |
| **Gerente / Admin** | Oficina | Revisión, aprobaciones, nómina |

Consecuencias no negociables:

- **Legibilidad al sol.** Texto oscuro sobre fondo claro, contraste alto, nada de gris claro sobre blanco.
- **Objetivos táctiles grandes** — mínimo 48px de alto en cualquier control que use el conductor o bodega.
- **Una acción primaria por pantalla**, visible sin desplazarse.
- **Mínimo tecleo** en las pantallas de operación. Botones, no formularios.

---

## 3. Identidad visual

### Colores de marca

```
#FFD313   Amarillo dorado    — acento e identidad
#333333   Gris oscuro        — texto principal
#FFFFFF   Blanco             — fondo
```

**Regla dura sobre el amarillo:** `#FFD313` sobre blanco tiene contraste ~1.5:1 y **no puede usarse como color de texto**. Funciona como fondo de badge, relleno de botón (con texto `#333333` encima, contraste ~8.5:1), borde, o barra de acento. Nunca como letra sobre fondo claro.

### Paleta funcional propuesta

Tres colores no alcanzan para ocho estados de pedido más advertencias y errores. Propuesta a validar:

**Neutros**
```
#FFFFFF  fondo
#F7F7F7  fondo secundario / tarjetas
#E5E5E5  bordes
#A3A3A3  texto deshabilitado
#6B6B6B  texto secundario
#333333  texto principal
```

**Semánticos** (texto sobre relleno)
```
Éxito       #1B7F4B  sobre  #DCFCE7
Advertencia #B45309  sobre  #FEF3C7
Error       #B3261E  sobre  #FEE2E2
Información #1D4ED8  sobre  #DBEAFE
```

El ámbar de advertencia es deliberadamente más oscuro y apagado que el amarillo de marca, para que no se confundan.

### Estados del pedido

Son ocho y tienen que distinguirse de un vistazo en una lista, en un celular, al sol:

| Estado | Etiqueta | Relleno | Texto |
|---|---|---|---|
| `DRAFT` | Borrador | `#F7F7F7` | `#6B6B6B` |
| `CONFIRMED` | Confirmado | `#FFD313` | `#333333` |
| `PICKED` | Separado | `#FEF3C7` | `#B45309` |
| `OUT_FOR_DELIVERY` | En ruta de entrega | `#DBEAFE` | `#1D4ED8` |
| `DELIVERED` | Entregado | `#CCFBF1` | `#0F766E` |
| `OUT_FOR_PICKUP` | En ruta de recogida | `#EDE9FE` | `#6D28D9` |
| `COMPLETED` | Completado | `#DCFCE7` | `#1B7F4B` |
| `CANCELLED` | Cancelado | `#FEE2E2` | `#B3261E` |

**"Con novedad" no es un estado**, es una marca adicional: un pedido puede estar *Completado* **y** tener novedad. Diseñar como distintivo independiente del badge de estado.

### Logotipo

La marca es un **logotipo caligráfico** que dice "Banquetes Consuelo C", entregado como **SVG completamente trazado**: un `<path>`, sin elementos de texto ni referencias a tipografía. Se renderiza en cualquier entorno sin instalar nada — **no hace falta ningún `.woff2`**.

- **Proporción 80 × 22 ≈ 3,6 : 1.** Muy horizontal.
- Viene con `fill="black"`; debe pasar a **`fill="currentColor"`** para heredar el color del contexto y adoptar el `#333333` de la marca en vez de negro puro.
- **Trazo muy fino.** En un PNG de 320 × 60 apenas hay 297 píxeles de negro pleno sobre 19.200. Es elegante y se desvanece con facilidad: hay que fijar un **tamaño mínimo de uso** y **nunca ponerlo sobre el amarillo** `#FFD313`.

Dónde aparece: la landing pública, el encabezado de los **tres impresos** y la barra lateral expandida en escritorio. En el resto de la app no hace falta — es una herramienta interna que cinco personas abren a diario; el espacio del encabezado vale más que la marca.

### La marca compacta

La proporción 3,6 : 1 no sirve en dos sitios, y para eso existe **`c-logo.svg`**: la "C" ornamentada sola, también trazada, de proporción 14 × 17.

- **Icono de la PWA** — fondo `#333333`, "C" en blanco, sin transparencia. Ya generado.
- **Barra lateral colapsada** — la misma "C", recoloreable.

Sobre el icono: la "C" ocupa el **58% de la altura** del lienzo. Android puede recortar el icono a un círculo o cuadrado redondeado y solo garantiza el **80% central**; con 58% las esquinas quedan dentro de esa zona segura por poco margen. Se probó al 50% y se descartó porque **a 64 px, el tamaño real en la pantalla de inicio, el trazo fino casi desaparece**.

### Tipografía de interfaz

Independiente del logotipo, y **la caligrafía no se usa para texto de interfaz**: en pantallas que se leen al sol, en un celular, con datos densos, es un problema de legibilidad.

Priorizar legibilidad sobre personalidad: una sans humanista o geométrica de buena lectura en pantalla pequeña. Escala generosa — el cuerpo mínimo en móvil es 16px, y los datos importantes (cantidades, totales, horas) van notablemente más grandes que las etiquetas.

## 4. Navegación

- **Móvil:** barra inferior con 3–4 destinos. Es el patrón principal.
- **Escritorio:** los mismos destinos como barra lateral colapsable con iconos.

Los destinos dependen del rol, y **un empleado puede tener varios roles a la vez** (es común que alguien sea bodega y conductor). La navegación muestra **la unión** de sus secciones. Hay que diseñar para 2, 3 y 5 destinos, no asumir un número fijo.

**El rol define la vista por defecto, no lo que el usuario puede hacer.** Con 5 empleados, si el de bodega se enferma le toca al vendedor alistar los pedidos. Los botones de cambio de estado están disponibles para cualquier empleado; lo que cambia por rol es en qué pantalla aterriza y qué ve primero. El diseño no debe sugerir que una acción está prohibida cuando solo es "de otro".

Destinos por rol:

| Rol | Ve |
|---|---|
| Ventas | Pedidos · Sin ruta · Mis horas |
| Bodega | Alistar · Novedades · Mis horas |
| Conductor | Ruta · Mis horas |
| Gerente | Pedidos · Despachos · Inventario · Nómina · Personal · Mis horas |
| Admin | Todo |

---

## 5. Pantallas

28 pantallas y tres formatos impresos. Las marcadas con ★ son las de uso diario y merecen el mayor esfuerzo.

**Acceso**
1. **Landing pública** — la ruta `/`. En esta primera etapa es solo el **logotipo sobre fondo blanco** y un enlace **"Empleados"** en la esquina superior derecha. Nada más: sin buscador, sin texto de marketing. Más adelante llevará la consulta de pedidos del cliente, así que el logo y el enlace deben quedar en la posición definitiva.
2. **Login** — correo y contraseña. Sin registro, sin "olvidé mi contraseña", sin enlaces externos.

**Pedidos** — Ventas, Gerente, Admin
3. ★ **Lista de pedidos** — con filtros por teléfono, nombre, fecha del evento (exacta o rango), estado, rango de monto, y "solo con novedad".
4. ★ **Detalle del pedido** — datos, ítems, totales, pagos, estado.
5. ★★ **Formulario de pedido** — crear y editar. La pantalla más importante y la más difícil. Ver sección 6.
6. **Registro de movimiento de caja** — hoja modal. Sirve tanto para abonos de un pedido como para egresos (nómina, transportador externo). Diálogo de confirmación obligatorio antes de guardar: **ningún movimiento se puede corregir después**.
7. **Línea de tiempo del pedido** — historial de quién hizo qué y cuándo.

**Operación** — Bodega, Conductor
8. ★ **Ruta del día** — solo los pedidos que mueve la empresa, ordenados por hora. Es la pantalla del conductor.
9. ★ **Alistar hoy** — **todos** los pedidos del día sin importar quién los mueva. Es la pantalla de bodega.
10. **Entregas sin ruta** — los que recoge el cliente o lleva un transportador externo.
11. ★ **Detalle operativo** — todo el pedido, incluidos los valores, más el botón grande de cambio de estado.
12. **Registro de novedad** — productos afectados, cantidad, **desenlace por producto** (perdido / inservible / recuperable), descripción, fotos tomadas con el celular, y responsable (que arranca en "Por determinar").

**Horas**
13. ★ **Mis horas** — cuatro marcas diarias: entrada mañana, salida mañana, entrada tarde, salida tarde. Se llena a diario desde el celular, así que las marcas tienen que ser de uno o dos toques.
14. ★ **Horas de un empleado** — la misma pantalla para Gerente y Admin, con un **desplegable para elegir el empleado**. La usan para capturar por quien olvidó registrar, así que el desplegable debe ser lo primero y quedar siempre visible: equivocarse de persona es el error caro.
15. **Horas del equipo** — vista de la semana con todos los empleados, para revisar antes de liquidar.

**Administración** — Gerente y Admin
16. **Productos** — lista agrupada por categoría, con foto. Los productos con **variantes** (un mantel en veinte colores) se muestran agrupados aquí, no como veinte filas sueltas.
17. **Editar producto** — nombre, categoría, grupo y nombre de variante, precio por día, cantidad total, foto.
18. **Empleados** — solo Admin puede crear y editar. Gerente solo ve. **Contiene salarios**: es una pantalla sensible.
19. **Editar empleado** — incluye asignación de **varios roles** y restablecer contraseña.
20. **Días festivos** — solo Admin edita.
21. ★ **Conteo físico** — capturar conteo parcial, con la lista sugerida de productos que tuvieron novedades recuperables. **Se usa con frecuencia**, no es una pantalla anual: merece el mismo cuidado que las de operación, y se llena de pie en la bodega con el celular.
22. ★ **Impresión del pedido** — formato de papel, no pantalla. Ver sección 6.1.
**Nómina** — Gerente y Admin
23. ★★ **Liquidación semanal** — la pantalla más importante del módulo. **Un empleado a la vez**, nunca los cinco en pantalla: liquidar a alguien con los datos de otro es el error que hay que hacer imposible. Nueve conceptos devengados con cantidad y valor, cuatro deducciones, totales y neto. Las cinco filas de horas llegan **precargadas** desde el registro de horas y el gerente puede corregirlas; el resto las digita. Cierra con un botón de **registrar pago**, que congela la liquidación.
24. ★ **Libro de caja** — listado filtrable de todos los movimientos, solo para Gerente y Admin. Filtros por fecha, concepto, método, entradas/salidas, monto y texto libre. Arriba, tres totales del periodo: entró, salió, neto. En móvil son tarjetas con los filtros en una hoja. Como los movimientos no se editan, cada uno ofrece **"registrar movimiento contrario"** en vez de un botón de editar.
25. **Recibo de caja** — tercer formato impreso. Ver 6.3.
26. **Configuración del sistema** — una sola pantalla con unos quince parámetros, **agrupados por módulo**: Empresa (datos para los impresos), Pedidos y Nómina (salario mínimo, auxilio, jornada, hora de corte nocturna, factores de recargo, tasas de pensión y salud). Más adelante se suman grupos para WhatsApp y las integraciones. Se toca pocas veces al año, pero un error aquí desajusta toda la nómina: cada campo necesita etiqueta en español y su unidad visible. Solo Admin y Gerente.
27. ★ **Comprobante de nómina** — formato impreso. Ver 6.2.
28. **Revisar conteo** — comparación sistema vs. contado, con aprobar o rechazar. Puede haber **varios conteos pendientes a la vez**, así que la pantalla necesita una lista, no un único conteo. Si dos pendientes comparten productos, hay que advertirlo al aprobar.

### Estados que toda pantalla necesita

Vacío · cargando · error · sin permiso para esta sección.

### Estados propios de este negocio

Estos son el diseño de verdad, no adornos:

- **Advertencia de sobrecupo** — la cantidad pedida supera el inventario disponible. **Advierte pero deja continuar.** Nunca bloquea.
- **Advertencia de festivo** — la fecha de entrega o de recogida cae en un día sin despacho. También advierte sin bloquear.
- **Choque de horario** — otro pedido ya tiene la misma hora de entrega o de recogida ese día. Tercera advertencia del mismo formulario, así que las tres tienen que poder convivir en pantalla sin sepultar los campos.
- **Pedido modificado después de separado** — ventas cambió el pedido cuando bodega ya lo había alistado. Tiene que saltar a la vista en la lista de despachos.
- **Confirmación de acción irreversible** — antes de registrar un pago. Texto distinto al de novedades y conteos, que sí se pueden reversar.
- **Pedido con novedad** — marca visible en listas y en el detalle.
- **Saldo pendiente** — visible sin alarmar: **no bloquea la entrega**, es informativo.
- **Método de entrega** — un pedido puede entregarlo la empresa, recogerlo el cliente en la bodega, o llevarlo un transportador externo. Se distingue en listas y detalle, y determina qué botón de estado aparece: los de "recoge el cliente" **se saltan** el estado *En ruta de entrega*.
- **Datos del transportador** — nombre y teléfono, visibles solo en los pedidos con transportador externo. **Nunca se le muestran al cliente**: muchas veces ni sabe que lo entregó un tercero.
- **Responsable de una novedad** — "Por determinar" al registrarla, y se resuelve después. Un daño sin responsable asignado es un pendiente que hay que ver.
- **Desenlace de una novedad** — no todo daño es pérdida. Un mantel manchado se lava y una silla sin soporte se repara: esas son **recuperables** y no descuentan inventario. Solo *perdido* e *inservible* restan. La diferencia tiene que quedar clara al registrar, porque quien lo hace está de pie en la bodega contando lo que volvió, y explica por qué el inventario no cambió.
- **Productos por contar** — en la pantalla de conteo físico, los productos con novedades recuperables pendientes desde el último conteo aparecen como lista sugerida.
- **Sin conexión** — el conductor entra a zonas sin señal. La app muestra los datos descargados con **la hora en que se capturaron** y con **todos los botones de acción deshabilitados**. Tiene que quedar obvio que está viendo una foto y que no puede marcar nada hasta recuperar señal, sin que parezca que la app se dañó.
- **Liquidación congelada** — una vez registrado el pago, la liquidación es de solo lectura y no hay forma de editarla. Tiene que leerse como algo cerrado y definitivo, no como un error o un permiso faltante.
- **Sin datos descargados** — si abre la app sin señal y no alcanzó a cargar hoy, no hay nada que mostrar. Es un vacío distinto al de "no hay entregas hoy" y necesita su propio mensaje.

---

## 6. El problema de diseño central: la grilla de productos

La toma de pedidos hoy funciona así: el cliente llama o escribe por WhatsApp, y el vendedor captura mientras habla. Un pedido típico tiene entre 5 y 30 líneas.

Cada línea necesita: **producto, cantidad, precio de lista, precio a cobrar (editable) y total de línea**. Cinco columnas. En escritorio es una tabla estilo factura y funciona. **En un teléfono no cabe.**

Además el vendedor negocia en vivo: ajusta el precio de un producto puntual, cambia los días de alquiler, mueve el valor del transporte, aplica un descuento en pesos sobre el subtotal.

**Se piden tres propuestas distintas para resolverlo en móvil**, no una:

- **A — Tarjetas.** Cada línea es una tarjeta apilada. Editar abre una hoja inferior. Cómodo pero largo de recorrer con 30 líneas.
- **B — Fila compacta expandible.** Una línea por producto (`120 × Silla Tiffany · $300.000`), que al tocarla se expande para editar en sitio. Más denso, más difícil de acertar con el dedo.
- **C — Captura rápida en dos pasos.** Buscador arriba que va agregando renglones editando solo la cantidad; los precios y descuentos se ajustan después en una vista de totales. Más rápido para capturar, exige un segundo paso.

El resto del formulario también va en la misma pantalla, **sin wizard por pasos**: teléfono y fecha del evento primero (autocompleta el cliente si el teléfono ya existe), fechas de entrega y recogida con hora, días de alquiler, la grilla, datos del cliente, totales, depósito de garantía y abonos.

---

### 6.1 El formato impreso

Media carta **vertical** (5.5 × 8.5 pulgadas), un solo formato para ventas, bodega y conductor. Se genera con CSS de impresión, no como PDF.

Debe caber: encabezado con el número de pedido, cliente y teléfono, dirección o la indicación de que recoge el cliente, las tres fechas con sus horas, días de alquiler, transportador externo si aplica, la tabla de ítems con precios, los totales completos, y **dos líneas de firma** —entrega y devolución— con nombre, cédula y fecha.

Es mucho para media hoja. La tipografía puede ser más pequeña que en pantalla, pero **las líneas de firma no se sacrifican**: son la prueba legal de que se entregó y de que volvió.

Un pedido de 30 líneas pasa a una **segunda media hoja**, repitiendo el número de pedido y numerando ("1 de 2"). Totales y firmas van siempre en la última.

### 6.2 El comprobante de nómina

Segundo formato impreso. Hoy existe como hoja de cálculo y se imprime; la app lo reemplaza.

Estructura de arriba abajo: logotipo y "PAGO DE NÓMINA", fecha de pago, nombre, cédula, **cargo y fecha de ingreso** del empleado, número de semana con el rango de lunes a domingo, la tabla de devengados (concepto · cantidad · valor), total devengado, la tabla de deducciones, total deducciones, **neto a pagar destacado**, el texto de recibido conforme, **línea de firma del trabajador**, y "Elaboró:" con el nombre de quien lo preparó.

Es un documento que el empleado firma y se archiva. La estética importa menos que la claridad: números alineados a la derecha, el neto inconfundible, y espacio real para firmar.

### 6.3 El recibo de caja

Tercer impreso, media carta vertical. Una sola plantilla con dos títulos: **"Recibo de caja"** para las entradas y **"Comprobante de egreso"** para las salidas.

Lleva: datos de la empresa, número consecutivo, fecha, "Recibido de" o "Pagado a", concepto, **monto en números y en letras**, método de pago, pedido relacionado si aplica, y línea de firma.

Es el más simple de los tres y el que menos cabe en media hoja de sobra — no hay que apretarlo.

---

## 7. Datos de ejemplo

Usar estos, no marcadores genéricos. Los rangos reales son lo que revela si el diseño aguanta.

**Productos** (precio por día)
```
Silla Tiffany dorada          Sillas y mesas          $2.500     inventario 800
Mesa redonda 10 puestos       Sillas y mesas         $12.000     inventario  60
Mantel blanco 3×3             Manteles y ruches       $8.000     inventario 120
Copa para vino tinto          Cristalería               $900     inventario 900
Tenedor de mesa               Cubiertos                 $600     inventario 900
Plato pando 26cm              Platos y vajilla          $800     inventario 700
Samovar rectangular           Samovares y bandejas   $35.000     inventario  18
Candelabro de piso 5 brazos   Decoración             $18.000     inventario  24
```

**Un producto con variantes** — grupo "Mantel cuadrado 50×50", categoría Manteles y ruches:
```
Dorado    $9.500   inventario  40
Rojo      $8.000   inventario  60
Verde     $8.000   inventario  55
Azul      $8.000   inventario  30
… hasta 20 colores
```
Cada color tiene **precio e inventario propios** y en la búsqueda del pedido aparece como una entrada suelta. Solo se agrupan en la pantalla de catálogo. Una lista de 20 colores en un celular es el caso a resolver.

**Categorías del catálogo:** Sillas y mesas · Manteles y ruches · Cristalería · Cubiertos · Platos y vajilla · Samovares y bandejas · Decoración

**Un pedido realista**
```
Pedido #1043
Cliente        Luz Marina Restrepo · 310 442 8890
Evento         Matrimonio · sábado 15 de agosto de 2026
Entrega        viernes 14 de agosto, 2:00 p.m.
Recogida       domingo 16 de agosto, 9:00 a.m.
Días cobrados  2

120 × Silla Tiffany dorada      $2.500   →   $600.000
 12 × Mesa redonda 10 puestos  $12.000   →   $288.000
120 × Copa para vino tinto        $900   →   $216.000

Subtotal        $1.104.000
Descuento          $104.000
Transporte         $180.000
Total           $1.180.000
Depósito           $200.000
Abonado            $500.000
Saldo              $680.000
```

**Un pedido que recoge el cliente** (para el caso sin ruta)
```
Pedido #1051
Cliente        Jorge Iván Betancur · 300 771 2043
Entrega        Recoge el cliente en la bodega · jueves 20 de agosto, 8:00 a.m.
Retorno        Transportador externo · Wilson Muñoz · 311 908 5512
Transporte     $60.000
```

**Direcciones en dos líneas** — la segunda es la que hace encontrable el sitio:
```
Vereda El Chuscal km 3, Envigado
  Finca Villa Carmen, portón blanco después del puente

Cra 43A #18-95, El Poblado
  Salón Social Torre Verde, piso 2
```

Notas para probar el diseño: los montos llegan a siete dígitos con separadores; `En ruta de recogida` es la etiqueta de estado más larga; un pedido de cristalería puede tener 30 líneas; los nombres de producto llegan a 28 caracteres.

---

## 8. Fuera de alcance

No diseñar nada de esto:

- Catering, decoración como servicio, u organización de eventos. **Solo alquiler de menaje.**
- Consulta pública del cliente. Está en evaluación y por ahora **la app es solo interna**.
- Página de marketing, landing comercial, registro público.
- Recuperación de contraseña por correo.
- **Selector de tema claro/oscuro.** Un solo esquema.
- Pasarela de pago. Los pagos se registran a mano.
- Nada de WhatsApp. Las notificaciones son por correo y no tienen pantalla propia.
- Facturación e impuestos. Los precios ya incluyen todo.

---

## 9. Archivos de marca

Todos en la carpeta `marca/`, con su propio `LEEME.md`: el logotipo horizontal, la "C" sola, el icono de la app en SVG editable y los PNG de 512, 192 y 180.

**Nada de esto queda pendiente de diseñar.**
