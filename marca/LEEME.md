# Archivos de marca — Banquetes Consuelo C

## Qué es cada archivo

| Archivo | Uso | Va a |
|---|---|---|
| `banquetes-consuelo-c-logo.svg` | Logotipo completo, horizontal | `static/` |
| `c-logo.svg` | La "C" sola, trazo original sin fondo | `static/` |
| `icon-maskable.svg` | Icono de la app, fuente editable | `static/` |
| `icon-512.png` | Icono PWA 512 × 512 | `static/` |
| `icon-192.png` | Icono PWA 192 × 192 | `static/` |
| `apple-touch-icon.png` | Icono iOS 180 × 180 | `static/` |

Los dos logotipos están **completamente trazados**: un `<path>` cada uno, sin
elementos de texto ni referencias a tipografía. Se renderizan en cualquier
entorno sin instalar nada.

## El icono de la app

Fondo `#333333`, "C" en blanco, sin transparencia — un icono transparente se
ve mal sobre los fondos de la pantalla de inicio.

**La "C" ocupa el 58% de la altura del lienzo**, centrada. No es un número
arbitrario: Android puede recortar el icono a un círculo o un cuadrado
redondeado, y solo garantiza el **80% central** (la zona segura *maskable*).
Con 58% las esquinas del bloque quedan a 192 px del centro contra 205 de
margen seguro — entra por poco, y más grande se saldría.

Se probó también al 50%. Se descartó: **el trazo es una caligrafía muy fina** y
a 64 px, que es el tamaño real en la pantalla de inicio, casi desaparece. El
58% es lo más grande que la zona segura permite, y aun así conviene revisarlo
en un teléfono real antes de dar la fase 0 por cerrada.

## Recolorear el logotipo

`banquetes-consuelo-c-logo.svg` y `c-logo.svg` vienen con `fill="black"`.
Cambiarlo a **`fill="currentColor"`** para que hereden el color del contexto y
adopten el `#333333` de la marca en vez de negro puro.

El icono no: su blanco y su fondo son fijos a propósito.

## Reglas de uso

- El logotipo horizontal es **3,6 : 1**. Sirve centrado en la landing, en los
  encabezados de los tres impresos y en la barra lateral expandida. **No sirve**
  como icono de app ni en la barra lateral colapsada — para eso está la "C".
- **Nunca sobre el amarillo `#FFD313`.** El trazo fino desaparece.
- Fijar un **tamaño mínimo de uso** y no bajar de ahí.
- La caligrafía **no se usa para texto de interfaz**, solo para la marca.
