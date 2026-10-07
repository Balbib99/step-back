# Dirección visual: La camiseta

Estado: aprobada por el usuario el 2026-10-07 (maquetas: [camiseta.html](mockups/camiseta.html), [camiseta-v2.html](mockups/camiseta-v2.html)). Diseño desde cero; no se reutiliza nada de NBA Insight. La alternativa descartada, [box-score.html](mockups/box-score.html), queda como referencia para el detalle de partido (tabla de puntos por cuartos).

## Idea

Cada equipo es un campo de color con la rotulación en el pecho y su número en grande, como una camiseta. Al abrir la app, el color te dice de qué equipo hablas antes de leer una palabra. Todo lo demás es neutro para que ese color mande.

Lo que la hace propia y no una app deportiva genérica:
- Los 30 equipos tienen su paleta (`docs/design/team-palettes.json`). Los tres favoritos (MIN, LAL, PHI) no tienen más color que el resto: **van siempre primero**.
- La abreviatura del equipo, enorme y recortada, se repite como rotulación de camiseta dentro de cada carril.
- Las noticias son posts con el vídeo o la imagen como protagonista.

## Principios

1. **El color es información, no decoración.** Solo aparece el color de un equipo cuando el contenido es de ese equipo. Fuera de eso, grafito.
2. **Medios primero.** Si la fuente trae vídeo o imagen, se ve grande, a 16:9, arriba del texto secundario.
3. **Una mano, un móvil.** Todo se maneja con el pulgar: objetivos de al menos 44 px, navegación abajo, filtros en una fila deslizable.
4. **Dato honesto.** Siempre se ve cuándo se actualizó algo y si una fuente falla. Nada inventado.
5. **Calma.** Sin animación gratuita, sin notificaciones dentro de la app, sin nada que pida actuar.

## Color

### Base (modo oscuro, único en la v1)

| Token | Valor | Uso |
|---|---|---|
| `--ground` | `#0E1015` | Fondo de la app |
| `--surface` | `#1A1D25` | Tarjetas |
| `--surface-2` | `#232733` | Botones, miniaturas vacías, equipos sin color propio |
| `--line` | `#2F3442` | Bordes y separadores |
| `--text` | `#EEF0F3` | Texto principal |
| `--text-2` | `#A7ADBA` | Texto secundario |
| `--text-3` | `#7D8493` | Metadatos (hora, fuente) |
| `--live` | `#FF3B30` | Punto "en juego" |
| `--ok` | `#5DD39E` | Punto "actualizado" |

Todos los textos cumplen WCAG AA sobre su fondo. El modo claro queda para después de la v1.

### Paleta de equipo

Cada equipo define cuatro valores: `field` (fondo del carril o banda), `ink` (texto sobre el campo), `numeral` (marcador, abreviatura y acento) y `trim` (franja). Reglas:
- `ink` ≥ 4.5:1 y `numeral` ≥ 3:1 sobre `field` (comprobado con script; los valores ya ajustados están en el JSON).
- Los campos oscuros (BKN, SA, DEN, LAC, MIN, NO) llevan un borde interior de 1 px a `rgba(255,255,255,.16)` para no perderse sobre `--ground`.
- Los escudos se muestran siempre sobre un disco blanco (`rgba(255,255,255,.94)`), porque muchos se pierden sobre su propio color.
- Partido entre dos equipos: dos carriles apilados, cada uno con su paleta, separados por una franja de 4 px con el `trim` del segundo equipo.
- Noticia de dos equipos: banda partida en dos mitades. De más de dos equipos o de la liga: banda neutra "NBA".
- La paleta es una fuente única en `shared/` y se carga como variables CSS (`--field`, `--ink`, `--numeral`, `--trim`) con el atributo `data-team="XXX"`.

## Tipografía

**Archivo** (variable, ejes de ancho y de peso), una sola familia con tres voces:

| Voz | Ancho · Peso | Uso |
|---|---|---|
| Número de camiseta | 62 % · 800-900 | Marcadores (56 px), abreviaturas, números del día |
| Nombre y titular | 75-85 % · 700 | Nombres de equipo (21 px), titulares de noticia (21 px), títulos de sección (20 px) |
| Lectura | 100 % · 400-600 | Resúmenes (14 px), metadatos (12-13 px), botones (13 px) |

- Cifras tabulares (`font-variant-numeric: tabular-nums`) en marcadores, horas y clasificación.
- Interlineado 1.15 en titulares condensados y 1.4 en lectura. Líneas de lectura de menos de 70 caracteres.
- En producción se aloja en el propio servidor (licencia OFL), nunca desde Google Fonts, para funcionar sin conexión.

## Espaciado y forma

- Rejilla de 8 px. Margen lateral 16 px. Separación entre tarjetas 12-16 px.
- Radio único de 10 px para tarjetas, 8 px para medios dentro de tarjetas, pastilla completa para chips y botones.
- Sin sombras. La jerarquía la dan el color de campo y las superficies.

## Componentes

1. **Tarjeta de partido (carriles).** Cabecera de estado (competición · FINAL / Q3 4:12 con punto rojo / hora). Dos carriles de 76 px mínimo: escudo, nombre, récord y marcador. Pierde: marcador al 78 % de opacidad. Pie con pabellón y enlace a jugadas.
2. **Fila de partido (equipos sin color propio).** Fondo `--surface`, escudos pequeños y hora a la derecha.
3. **Post (noticia).** Anatomía fija, de arriba abajo:
   1. Banda de equipo: escudo en disco, abreviatura en `numeral`, nombre.
   2. Fuente: avatar, nombre, tipo (Vídeo, Imagen), idioma y hora.
   3. Titular (21 px) y, si lo hay, resumen de dos líneas.
   4. **Medio 16:9** con botón de reproducir y etiqueta ("Resumen", "Vídeo 0:21").
   5. Cita opcional (otro post o noticia relacionada).
   6. Pie: acciones "Traducir al español" (solo si está en inglés) y "Abrir fuente".
   Variantes: vídeo, imagen, solo texto, con cita.
4. **Chips de filtro.** Fila deslizable: Mis equipos, Todas, Vídeos, Español, y un chip por equipo con borde de su color.
5. **Tira de días** (Calendario): siete días con puntos de colores de los equipos favoritos que juegan.
6. **Mini partido** (Calendario): barra de color del equipo a la izquierda y hora o resultado a la derecha.
7. **Cabecera de equipo.** Campo del equipo a todo ancho, escudo grande, récord en `numeral` y franja de 6 px. Debajo, pestañas Noticias, Jugadas, Calendario y Plantilla.
8. **Barra inferior** de cinco pestañas (Hoy, Calendario, Clasificación, Noticias, Jugadas) con indicador bajo la activa.
9. **Indicador de frescura** en la barra superior: punto verde y "Actualizado HH:MM". Se vuelve ámbar si la fuente falla.

## Medios

- **Vídeo:** reproductor embebido (YouTube con `youtube-nocookie.com`); vídeos de ESPN abren su fuente si no admiten embed.
- **Imágenes:** miniaturas de ESPN y de RSS, servidas a través del servidor propio y cacheadas, para que se vean sin conexión y para no filtrar tu IP a terceros.
- Si no hay medio, el post se queda en texto con su banda de color; nunca se rellena con una imagen falsa.
- Escudos de los 30 equipos: se descargan una vez al servidor y se sirven desde ahí.

## Estados

| Estado | Tratamiento |
|---|---|
| Cargando | Esqueletos con la forma de la tarjeta; los carriles aparecen en grafito y toman su color al llegar los datos |
| Vacío | Una línea que explica y orienta ("Hoy no juegan tus equipos. Mira el calendario.") |
| Error de una fuente | Aviso discreto en la sección ("ESPN no responde. Mostrando datos de las 21:10.") y punto ámbar en la barra superior |
| Sin conexión | Banda fina "Sin conexión · actualizado hace X" y contenido guardado |
| En directo | Punto rojo y reloj del cuarto en la cabecera de la tarjeta; el marcador se actualiza en el sitio |

## Movimiento

Un solo momento con intención: cuando un marcador cambia en directo, la cifra hace un pequeño "tick" (desplazamiento vertical de 6 px y fundido, 200 ms). El resto es instantáneo. Se respeta `prefers-reduced-motion` (sin tick).

## Tono de los textos

Español neutro, frases cortas, verbos claros: "Traducir al español", "Abrir fuente", "Ver original". Sin exclamaciones ni jerga. Los errores explican qué pasó y qué se ve en su lugar.

## Accesibilidad

- Contraste AA en todo el texto; el color nunca es la única señal (siempre abreviatura y escudo).
- Objetivos táctiles ≥ 44 px; foco visible con contorno de 3 px.
- Estructura semántica: cada tarjeta es un `article`, la navegación es `nav`.
- Reproductores con título accesible y sin reproducción automática.

## Decisiones abiertas

- Modo claro (después de la v1).
- Ocultar marcadores para no destripar partidos que aún no has visto (opción en Ajustes, pendiente de decidir).
- Diseño de escritorio: columna centrada de unos 480 px en la v1; dos columnas más adelante si hace falta.
- Si los vídeos de ESPN admiten embed: se comprueba en `highlights`.
