# POWER

Adaptación digital no oficial del juego de mesa **Power** (1981; edición Spear's Games de los 90)
para jugar en el navegador contra 1–3 generales controlados por la IA.

## Jugar

- **Doble clic en `Jugar.bat`** (o abre `dist/index.html` en el navegador). No necesita servidor ni conexión.
- Para desarrollo: `npm install` y `npm run dev`.

## Cómo se juega (resumen)

Cada ronda todos escriben hasta 5 órdenes en secreto; después se ejecutan a la vez, se resuelven
los combates por suma de poder (sin dados) y se cobra Power por ocupar territorio enemigo.
Gana quien captura todas las banderas llevando infantería a los Cuarteles Generales rivales.
El reglamento completo está dentro del juego, en **Cómo jugar**.

Controles:

| Acción | Cómo |
|---|---|
| Mover una pieza | Clic en la pieza, clic en el destino resaltado |
| Sacar de la Reserva | Clic en la pieza en tu tarjeta |
| Comprar / canjear / Megamisil | Botones de tu tarjeta o del menú de la casilla |
| Quitar una orden | ✕ en la hoja, `Retroceso` o `Ctrl+Z` |
| Ejecutar la ronda | Botón amarillo o `Intro` |
| Cancelar selección / pausa | `Esc` (o clic derecho) |
| Saltar la animación | `Espacio` |

Opciones de partida: 2, 3 (con ejército mercenario) o 4 jugadores, color, general rival
(seis personalidades) y nivel (Recluta, Capitán, General), reloj de órdenes y límite de 2 horas.
La partida se guarda sola al empezar cada ronda. Idiomas: español e inglés.

## Reglas y supuestos

`PLAN.md` recoge las reglas implementadas y los nueve puntos donde el reglamento no es explícito
y hubo que decidir (por ejemplo, que los Megamisiles detonan cuando todos han movido).

## Código

```
src/engine/   Reglas puras: tablero (grafo de 57 casillas), órdenes, resolución de ronda
src/ai/       Análisis, evaluación, planificador por simulación y generales
src/ui/       Interfaz: tablero SVG, pantalla de juego, menús, audio, idiomas, guardado
tests/        Vitest: reglas, variantes y partidas completas IA contra IA
tools/        selfplay.ts (diagnóstico de la IA), render-midi.cjs (MIDI a WAV)
Audio/        Recursos originales (WAV y MIDI)
public/audio/ Los mismos, convertidos a MP3 para el navegador
```

Comandos: `npm test`, `npm run build`, `npx vite-node tools/selfplay.ts 4 10 2222`.
Añadir `#autoplay` a la URL hace que una IA juegue tu asiento (útil para depurar).

La música se generó renderizando los MIDI con `js-synthesizer` y la fuente GeneralUser GS, y
codificando con ffmpeg; `tools/render-midi.cjs` necesita ambos instalados aparte.
