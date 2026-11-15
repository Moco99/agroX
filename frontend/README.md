# AGROX · Exploración

Vista local inspirada en la referencia visual: globo terrestre, resumen regional,
evolución del NDVI y compatibilidad de cultivos. No modifica el recolector Python.

## Ejecutar

Requiere Node.js 18 o posterior, sin dependencias de npm.

```sh
npm run dev
```

Abre http://127.0.0.1:5173. Para comprobar la sintaxis: `npm run check`.

## Alcance

- Globo y mapa satelital en un único visor WebGL, con arrastre, zoom, centrado
  y pantalla completa. Requiere aceleración gráfica del navegador.
- Búsqueda y selección de Argentina, Bajío de México, Iowa y Veracruz.
- Acercamiento continuo con MapLibre GL JS 5.6.2, proyección de globo y Esri World
  Imagery. Se conserva la misma cámara, fuente y superficie durante todo el recorrido,
  sin alternar visores al superar un umbral. «Explorar terrenos» anima el acercamiento
  a zoom 16; rueda, botones, doble clic y gestos táctiles recorren los niveles 0–19.
  «Vista global» se aleja conservando el centro del mapa. Se respeta movimiento reducido.
- Imágenes satelitales disponibles con conexión a Internet. Resolución y fecha
  variables según la zona; las fechas del panel no filtran este mapa base.
  Los límites de propiedad y la superposición NDVI aún no están conectados.
- Si falta una tesela, se solicita con `blankTile=false` y se busca su antecesora
  disponible. Se recorta la porción geográfica exacta y se amplía sin mostrar el
  aviso gris del proveedor. Esto conserva la cobertura, pero no inventa detalle.
  La caché en memoria está limitada a 192 entradas. Pruebas: `npm test`.
- Indicadores ilustrativos por región y mes, gráfica a tres o seis meses,
  reproducción temporal y detalles de compatibilidad.
- Favoritos almacenados en el navegador y exportación CSV de demostración.
- Diseño adaptable a escritorio, tablet y teléfono; controles accesibles por teclado.
- Los filtros de fechas y la selección de capas preparan el estado de la interfaz.
  No descargan datos ni dibujan superposiciones geográficas reales.
- Los módulos adicionales y el asistente muestran su estado pendiente; no hay
  autenticación, servicio de IA ni conexión con `scraper/`.

Los valores son **datos de demostración**, no recomendaciones agronómicas.

## Motor e imágenes

MapLibre se incluye en `vendor/maplibre/` junto con su licencia BSD-3-Clause
(`vendor/maplibre/LICENSE.txt`). El mapa realiza peticiones a Esri World
Imagery, con atribución visible al proveedor y sus colaboradores. Información del
servicio: https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer.
