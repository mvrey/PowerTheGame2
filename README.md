# POWER

An unofficial digital adaptation of the board game **Power** (1981; Spear's Games edition of the
90s), played in the browser against one to three AI generals.

Power is a strategy game with no dice. Every round all players write up to five orders in secret,
the orders are carried out at once, and battles are settled by adding up the power of the pieces
on each space. You win by walking infantry into every rival headquarters and taking its flag.

## Play

- **Double-click `Jugar.bat`**, or open `dist/index.html` (or the root `index.html`) in a browser.
  No server and no connection are needed.
- For development: `npm install`, then `npm run dev`.

The game is in Spanish and English (Options → Language). The full rules are inside the game,
under **How to play**.

### Controls

| Action | How |
|---|---|
| Move a piece | Click the piece, then a highlighted destination |
| Deploy from the Reserve | Click the piece on your army card |
| Buy, trade up, build a Megamissile | Buttons on your card or in the space's pop-up |
| Remove an order | ✕ on the order sheet, `Backspace` or `Ctrl+Z` |
| Execute the round | Yellow button or `Enter` |
| Cancel a selection / pause | `Esc` (or right click) |
| Skip the animation | `Space` |

### Game options

- **Map**: five boards (see below).
- **Players**: 4 (free for all), 3 (the fourth army is mercenary and anyone may order it about)
  or 2 (two allied armies each).
- **Rivals**: six generals with different temperaments, each at one of three levels
  (Recruit, Captain, General), plus any bot you write (see below).
- **Clocks**: the official 3-minute order clock and 2-hour game limit, both optional.

The game saves itself at the start of every round.

## Maps

| Map | What changes |
|---|---|
| **Classic** | The original board: four territories joined by five islands. |
| **Mainland** | No islands and no channels. Territories share land borders, so tanks cross in one move and the war is fast. Ships are confined to the rim. |
| **Ring** | The classic board without its central island. By land you only reach your two neighbours; the army opposite is far away. |
| **Crossroads** | A single central island is the only land crossing, while four long sea lanes run from HQ to HQ: a destroyer reaches a neighbouring HQ in two moves. |
| **Archipelago** | Small four-sector homelands among seventeen islands. Ground forces must stop on every island, so crossing takes four rounds and ships and planes decide the war. |

Every map is checked by tests to be fair (all four armies see the same distances to their
neighbours and have the same amount of land) and fully connected for every kind of unit.

### Adding a map

Maps are plain text grids in `src/engine/maps.ts`. Each cell names the space it belongs to:

| Cell | Meaning |
|---|---|
| `G4` `B0` `Y7` `R2` | Sector of the Green / Blue / Yellow / Red territory, with its number |
| `HQG` `HQB` `HQY` `HQR` | Headquarters of an army |
| `IN` `IX` `IA` … | Island (the text after `I` is its label) |
| `S1` `S2` … | Sea lane |
| `.` | Nothing: no piece can ever be there |

```ts
{
  id: 'mymap',
  rows: [
    'HQG S1  S1  S1  S2  S2  S2  HQB',
    'S8  G8  G6  G3  B5  B7  B8  S3',
    // ...
  ],
}
```

- A name repeated on several cells makes one bigger space (sea lanes usually are).
- Spaces are adjacent when their cells touch, diagonals included, except that two sea lanes
  never connect: ships must pass through a coast, an island or an HQ.
- Sectors that touch no sea lane are inland, and ships cannot enter them.
- Every map needs the four armies, each with an HQ next to one of its sectors.
- Rows and columns without sectors are drawn narrower; `cols` and `heights` override the sizes.

Then add its name and description to `src/ui/i18n.ts` (`map.mymap`, `map.mymap.text`, in both
languages; `tests/i18n.test.ts` fails until both are there). The board drawing, the movement
tables and the bots all derive from the grid, and `tests/maps.test.ts` automatically checks the
new map for soundness, fairness and full AI games.

## Rules and assumptions

`PLAN.md` (in Spanish) lists the rules as implemented and the nine points where the rulebook is not explicit
and a decision had to be made (for example, Megamissiles detonate once everyone has moved).

## Write your own bot

Opponents are pluggable. A bot is a file named `*.bot.ts` under `src/bots/` exporting a
definition with a `decide(view, ctx)` function that returns the round's orders; it is picked up
automatically and appears in the game's menus, in the arena and on the server. Bots can also be
separate programs, in any language, that play over HTTP.

```
npm run arena -- bots=mybot,okoye:3,kruger,vega games=10   # headless tournament
npm run server                                             # host matches over HTTP
python examples/http_bot.py --vs kruger:1,vega:1,rookie    # a remote bot in Python
```

**[BOTS.md](BOTS.md)** is the guide: the bot contract, the toolkit (order sheets, legal orders,
simulation with the real rules), testing, and the HTTP endpoints. `ARCHITECTURE.md` explains how
the engine, its API, the bots and the hosts fit together.

## How the generals play

All players move at once, so there is no turn tree to search. Each general builds several candidate
plans out of small tactics (defend the HQ, attack a space with just enough force, occupy enemy
land for income, trade up, march infantry on a flag, and so on), imagines several plans for each
rival the same way, plays every candidate against every scenario with the real rules engine and
keeps the plan with the best outcome. The level sets how many plans and scenarios it weighs; the
general's temperament weights both the tactics and the evaluation. It looks one round ahead.
The generals are ordinary bots written against the public API (`src/bots/generals/`).

## Code

```
src/engine/   Pure rules: maps, board graph, orders, round resolution (internal)
src/api/      The engine's public API: Match, views, order sheets, legal orders, simulation,
              the bot contract, local and HTTP clients
src/bots/     Bot registry; the generals; example bots (Rookie, Greedy)
src/ui/       Browser host: SVG board, menus, audio, languages, saving
src/ui/game/  The game screen: planning, playback, panels, dialogs
src/server/   HTTP server hosting matches for remote bots
src/cli/      Command-line arguments shared by the server and the tools
tests/        Vitest: rules, API, bots, maps, translations, HTTP server, architecture boundaries
tools/        arena.ts (tournaments), remote-bot.ts (play on a server), render-midi.cjs (MIDI to WAV)
examples/     http_bot.py, a bot in Python over HTTP
Audio/        Original assets (WAV and MIDI)
public/audio/ The same, converted to MP3 for the browser
```

Commands: `npm test`, `npm run build`, `npm run lint`, `npm run format`, `npm run arena`,
`npm run server`, `npm run bot`.
Adding `#autoplay` to the URL makes an AI play your seat, which is handy for debugging.

The music was produced by rendering the MIDI files with `js-synthesizer` and the GeneralUser GS
soundfont and encoding with ffmpeg; `tools/render-midi.cjs` needs both installed separately.
