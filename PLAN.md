# POWER — Plan de desarrollo

Adaptación digital del juego de mesa **Power** (1981, edición Spear's Games de los 90) para
jugar en el navegador contra 1–3 IAs, siguiendo el reglamento oficial.

## 1. Decisiones de ingeniería

| Tema | Decisión | Motivo |
|---|---|---|
| Plataforma | Navegador (requisito de `Notas.txt`: web, no Unity) | |
| Lenguaje / build | TypeScript + Vite, sin framework de UI | Juego pequeño, DOM + SVG bastan; cero dependencias en runtime |
| Render | SVG generado por código (tablero y piezas) | Nítido a cualquier tamaño, hit-testing gratis, animable |
| Distribución | `dist/index.html` autocontenido (JS/CSS inline) + carpeta `audio/` | Se abre con doble clic, sin servidor |
| Motor | Módulo puro y determinista (`src/engine`), sin DOM | Testeable, reutilizado por la IA para simular |
| IA | Generación de planes por "macros" + simulación contra planes rivales muestreados con el propio motor | Juego de movimientos simultáneos: se elige el plan con mejor resultado esperado |
| Tests | Vitest: reglas, resolución de conflictos y fuzz IA-vs-IA con invariantes | |
| Audio | WAV originales convertidos a OGG/MP3; MIDI renderizados offline a audio | El navegador no reproduce MIDI |
| Guardado | `localStorage` (autoguardado por ronda + continuar) | |
| Idioma | Español (por defecto) e inglés | |

Fuera de alcance (están en `Notas.txt` como ideas, no en el encargo): multijugador online,
chat, Docker, dominio propio, marketing.

## 2. Reglas implementadas (reglamento oficial)

### Tablero (57 casillas)
- 4 territorios (Verde NO, Azul NE, Rojo SO, Amarillo SE) de 3×3 sectores numerados 0–8:
  el 0 es la esquina que toca la isla X, el 8 la que toca el Cuartel General, el 4 es el centro.
- 4 Cuarteles Generales (HQ) en las esquinas del tablero. 5 islas: N, E, S, O y X (centro).
- 12 vías marítimas: S1–S4 interiores (entre territorios), S5–S12 exteriores.
- Adyacencias: sectores en 8 direcciones dentro del territorio; cada vía toca los 3 sectores
  costeros de cada territorio que baña y las islas/HQ de sus extremos; cada isla toca los
  sectores esquina vecinos; el HQ toca el sector 8 y sus dos vías. Las vías no se tocan entre sí.

### Piezas
| Pieza | Mov. | Poder | 3 → | Mov. | Poder |
|---|---|---|---|---|---|
| Soldado | 2 | 2 | Regimiento | 2 | 20 |
| Tanque | 3 | 3 | Tanque pesado | 3 | 30 |
| Caza | 5 | 5 | Bombardero | 5 | 25 |
| Destructor | 1 | 10 | Crucero | 1 | 50 |
| Megamisil | — | 0 | (≥100 de poder en piezas/Power) | | |

- Tierra (soldado, regimiento, tanques): no entran al mar; entrar en isla o HQ termina el movimiento.
- Aire: no sobrevuela el mar; puede sobrevolar islas sin parar (cuentan como sector).
- Mar: vías, sectores costeros, islas y HQ; nunca el sector 4.
- No hay bloqueo de paso por piezas enemigas.

### Ronda (6 fases)
1. **Órdenes**: hasta 5 por ejército, en secreto, 3 min (6 min y 10 órdenes con 2 jugadores).
   Tipos: mover 1 pieza, sacar 1 pieza de la Reserva al HQ, comprar con Power (2/3/5/10),
   canjear 3 iguales por la grande, crear Megamisil, lanzar Megamisil.
   Una pieza mueve una vez por ronda; mover y luego canjear sí, canjear en tablero y mover no;
   en la Reserva se puede canjear varias veces y luego salir al HQ.
   Quien no ejecuta ninguna orden paga 1 Power (o convierte su pieza más pequeña).
2. **Ejecución** empezando por el árbitro (rota cada ronda) en sentido horario.
3. **Conflictos**: suma de poder por bando en cada casilla; el mayor captura todo.
   Empates primero: las piezas que acaban de mover rebotan a su origen (una vez por ronda).
4. **Capturas**: las piezas pasan al color del vencedor y a su Reserva.
5. **Power**: 1 por territorio enemigo con bandera ocupado (máx. 3).
6. **Banderas**: se captura si se domina el HQ enemigo con al menos un Soldado/Regimiento;
   el vencedor se queda con todas las piezas y Power del eliminado.

### Megamisil
Se crea donde estén las piezas (sector o Reserva; el exceso sobre 100 se pierde), se lanza a
cualquier casilla, HQ o Reserva; destruye todo menos la bandera; poder 0 si no se lanza (capturable).

### Fin
Gana quien capture todas las banderas rivales. Límite oficial de 2 h: gana el mayor poder total
(desempate: más banderas).

### Variantes
- **2 jugadores**: 2 ejércitos adyacentes cada uno, 5 órdenes por ejército, fuerzas aliadas suman.
- **3 jugadores**: el 4.º ejército es mercenario; cualquiera puede darle órdenes; órdenes
  contradictorias sobre la misma pieza se anulan.

### Supuestos (lo que el reglamento no fija)
1. Los Megamisiles detonan al final de la fase de ejecución, tras todos los movimientos
   (simultaneidad; coherente con «dos misiles sobre el mismo sector se destruyen ambos»).
2. Sin límite de piezas físicas por color.
3. Los barcos pueden moverse entre sectores costeros contiguos.
4. El HQ no forma parte del territorio a efectos de cobrar Power.
5. Bandera: basta con ser el único ocupante de un HQ enemigo con infantería al final de la ronda.
   Capturas de bandera simultáneas se resuelven en orden de árbitro.
6. Empate sin piezas que puedan rebotar: las fuerzas empatadas conviven; el resto combate entre sí.
7. Una pieza creada por canje en el tablero se considera estacionaria (no rebota).
8. 2 jugadores: las capturas van al ejército aliado con más poder en ese combate.
9. 3 jugadores: no hace falta capturar la bandera mercenaria para ganar.

## 3. Arquitectura

```
src/engine/   board.ts (grafo), types.ts, rules.ts (órdenes), resolve.ts (ronda + eventos), game.ts
src/ai/       evaluate.ts, planner.ts, generals.ts (personalidades y niveles)
src/ui/       app, screens (menú, nueva partida, juego, opciones, reglas, fin), boardView, pieces,
              orderSheet, animator, audio, i18n, storage
tests/        reglas, conflictos, variantes, fuzz IA
tools/        render de MIDI y conversión de audio
```

## 4. UX
- Menú principal: Nueva partida, Continuar, Cómo jugar, Opciones.
- Nueva partida: nº de jugadores, color, generales rivales y dificultad, temporizador y límite.
- Partida: tablero central; tarjetas de jugador con Reserva; hoja de órdenes con deshacer;
  resaltado de destinos legales; flechas de órdenes; tooltip de poder por casilla;
  reproducción animada de la ronda con velocidad/saltar; registro de eventos.
- Fin de partida con estadísticas.

## 5. Fases de ejecución
1. Scaffold + audio. 2. Motor + tests. 3. IA + fuzz. 4. UI de tablero y órdenes.
5. Reproducción de ronda, audio, pantallas. 6. Guardado, i18n, tutorial.
7. Bughunting (tests, partidas reales en navegador, revisión de código). 8. Build final + README.

## 6. Estado

Todas las fases completadas. Verificación realizada:

- 40 tests (reglas, variantes de 2 y 3 jugadores, partidas completas IA contra IA sin órdenes ilegales).
- Partidas completas de 2, 3 y 4 jugadores jugadas en navegador (modo `#autoplay`) sin errores de consola.
- Recorrido de la interfaz con navegador automatizado (capturas revisadas): órdenes, canjes, Megamisil, Reserva, pausa, opciones, idiomas,
  guardado y continuación, eliminación del jugador, reloj de órdenes, límite de 2 horas, fin de partida, ventana estrecha.
- Build de producción probado abriendo `dist/index.html` directamente (file://), con audio.
