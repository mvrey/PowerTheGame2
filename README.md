# Bot Jam

A platform for **recurring bot-programming competitions**. Participants write programs, in Python or
JavaScript, that play a game on their own. The platform runs them in a sandbox, plays a World Cup
style tournament between them, records verifiable replays, and shows the matches to a live audience.
Every edition brings a new game. **Edition 1: Power** (1981), a strategy game of simultaneous orders.
**Edition 2: Konquest**, KDE's game of galactic conquest: fleets in flight, battles with dice.

| I want to… | Read |
|---|---|
| write a bot | [Docs/Participants.md](Docs/Participants.md), then [Docs/Games/Power.md](Docs/Games/Power.md) or [Docs/Games/Konquest.md](Docs/Games/Konquest.md) |
| run an edition, or stream it | [Docs/Organizer.md](Docs/Organizer.md) |
| know the competition rules | [Docs/Tournament.md](Docs/Tournament.md) |
| talk to the referee from any language | [Docs/Protocol.md](Docs/Protocol.md) |
| check how untrusted code is contained | [Docs/Sandbox.md](Docs/Sandbox.md) |
| understand the code, or add the next game | [ARCHITECTURE.md](ARCHITECTURE.md) |

## Quick start

```
npm install
npm run jam -- new python bots/mybot                          # a starter bot (or: javascript)
npm run jam -- check bots/mybot                               # does it play well-behaved matches?
npm run jam -- match --bot bots/mybot --bot builtin:okoye:2   # one match, saved as replay.json
npm run build && npm run jam -- serve .                       # watch it: http://127.0.0.1:8080/?replay=data/replay.json
npm run jam -- tournament examples/tournament.json            # a whole World Cup, with built-in bots
npm run jam -- help                                           # every command
```

Every command takes `--game konquest` for edition 2 (Power is the default), for example
`npm run jam -- new python bots/kq --game konquest` and
`npm run jam -- match --game konquest --bot bots/kq --bot builtin:becai`.
`examples/konquest-tournament.json` is a World Cup of Konquest bots.

Requirements: Node.js 22+, and Python 3.12+ for Python bots. Official matches run in Docker with
gVisor on Linux ([Docs/Sandbox.md](Docs/Sandbox.md)).

## What is in the box

| | |
|---|---|
| **Referee** | Plays matches over a JSON-lines stdin/stdout protocol, with deadlines. Any misbehaviour costs the bot a turn, never stops the match, and is recorded. |
| **Sandbox** | One hardened container per bot per match: no network, read-only, unprivileged, CPU/memory/process limits, gVisor. Safe unpacking of submission zips. |
| **Replays** | Every raw answer, timing, failure, event and state hash, plus the exact version of each bot. `jam verify` plays any replay again and checks it. |
| **Tournament** | Groups with seat-swapped duels and a free-for-all rotation, then a seeded knockout of series, a third-place match and an exhibition. Resumable and deterministic. |
| **Viewer** | Tables, bracket, results and any match with a timeline, plus a self-directing broadcast mode for OBS. |
| **SDKs** | `sdk/python`, `sdk/javascript`: the protocol loop and the game's helpers, standard library only. |
| **Built-in bots** | Reference opponents. Power: six AI generals at three levels. Konquest: KDE's own AIs (Default and Becai). Both: examples, and a generic Monte Carlo baseline. |

## Repository

```
src/platform/   the game-agnostic platform: core (contracts, referee, replays, tournament, bot kit), node
                (runners, sandbox, executor), web (DOM helpers, dialogs, storage, texts, base styles)
src/games/      the games, each with engine, api, built-in bots, jam module, browser game, viewer renderer:
                power/, konquest/
src/jam/        the `jam` command          src/viewer/   the spectator viewer
sdk/  templates/  sandbox/docker/  examples/  tools/research.ts (Phase-1 balance checks)
tests/          platform/ (referee, runners, adversarial bots, submissions, tournament), power/, konquest/,
                architecture, games (what each game registers)
Docs/           rules, protocol, sandbox, guides; Docs/Games/<game>.md
```

Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`, `npm run build`
(both games and the viewer), `npm run jam -- <command>`, `npm run research [-- --game konquest]`.

## Edition 1: Power, the browser game

You can also play Power yourself, in Spanish or English, against the built-in generals. It is
the best way to get a feel for the game before writing a bot.

### Play it

- **Double-click `Jugar.bat`**, or open `dist/index.html` (or the root `index.html`) in a browser.
  No server and no connection are needed.
- For development: `npm install`, then `npm run dev`.

The game is in Spanish and English (Options → Language). The full rules are inside the game,
under **How to play**.

#### Controls

| Action | How |
|---|---|
| Move a piece | Click the piece, then a highlighted destination |
| Deploy from the Reserve | Click the piece on your army card |
| Buy, trade up, build a Megamissile | Buttons on your card or in the space's pop-up |
| Remove an order | ✕ on the order sheet, `Backspace` or `Ctrl+Z` |
| Execute the round | Yellow button or `Enter` |
| Cancel a selection / pause | `Esc` (or right click) |
| Skip the animation | `Space` |

#### Game options

- **Map**: five boards (see below).
- **Players**: 4 (free for all), 3 (the fourth army is mercenary and anyone may order it about)
  or 2 (two allied armies each).
- **Rivals**: six generals with different temperaments, each at one of three levels
  (Recruit, Captain, General), plus the example bots.
- **Clocks**: the official 3-minute order clock and 2-hour game limit, both optional.

The game saves itself at the start of every round.

### Maps

| Map | What changes |
|---|---|
| **Classic** | The original board: four territories joined by five islands. |
| **Mainland** | No islands and no channels. Territories share land borders, so tanks cross in one move and the war is fast. Ships are confined to the rim. |
| **Ring** | The classic board without its central island. By land you only reach your two neighbours; the army opposite is far away. |
| **Crossroads** | A single central island is the only land crossing, while four long sea lanes run from HQ to HQ: a destroyer reaches a neighbouring HQ in two moves. |
| **Archipelago** | Small four-sector homelands among seventeen islands. Ground forces must stop on every island, so crossing takes four rounds and ships and planes decide the war. |

Every map is checked by tests to be fair (all four armies see the same distances to their
neighbours and have the same amount of land) and fully connected for every kind of unit.

#### Adding a map

Maps are plain text grids in `src/games/power/engine/maps.ts`. Each cell names the space it belongs to:

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

Then add its name and description to `src/games/power/play/i18n.ts` (`map.mymap`, `map.mymap.text`, in both
languages; `tests/power/i18n.test.ts` fails until both are there). The board drawing, the movement
tables and the bots all derive from the grid, and `tests/power/maps.test.ts` automatically checks the
new map for soundness, fairness and full AI games.

### Rules and assumptions

`PLAN.md` (in Spanish) lists the rules as implemented and the nine points where the rulebook is
not explicit and a decision had to be made (for example, Megamissiles detonate once everyone has
moved). [Docs/Games/Power.md](Docs/Games/Power.md) has a one-page summary in English.

### How the generals play

All players move at once, so there is no turn tree to search. Each general builds several candidate
plans out of small tactics (defend the HQ, attack a space with just enough force, occupy enemy
land for income, trade up, march infantry on a flag, and so on), imagines several plans for each
rival the same way, plays every candidate against every scenario with the real rules engine and
keeps the plan with the best outcome. The level sets how many plans and scenarios it weighs; the
general's temperament weights both the tactics and the evaluation. It looks one round ahead.
The generals are ordinary bots written against the public API (`src/bots/generals/`).

The music was produced by rendering the MIDI files with `js-synthesizer` and the GeneralUser GS
soundfont and encoding with ffmpeg; `tools/render-midi.cjs` needs both installed separately.

## Edition 2: Konquest, the browser game

KDE's Konquest, with its rules and its AIs, in Spanish or English. Play it against KDE's own
computer players, or with friends at the same computer (hot seat).

### Play it

- **Double-click `Konquest.bat`**, or open `dist/konquest.html` after `npm run build`.
  No server and no connection are needed.
- For development: `npm run dev:konquest`.

#### Controls

| Action | How |
|---|---|
| Send a fleet | Click one of your planets, set the ships (box, slider, *Half*, *All*), click the destination |
| Standing order | Tick *Repeat every turn* before picking the destination |
| Remove a fleet | ✕ in the list, `Backspace` or `Ctrl+Z` |
| Planet details, flight time | Hover over a planet |
| End the turn | Yellow button or `Enter` |
| Cancel a selection | `Esc` |
| Skip the animation | `Space` |

#### Game options

- **Galaxy**: small, standard, large, KDE's classic (10 × 10, three neutrals, all at random) or
  a custom grid (5 to 30 sectors a side, any number of neutral planets). *Fair placement* mirrors
  or balances the homes; without it, everything is placed at random as in KDE.
- **Players**: 2 to 10, each human or one of the AIs: KDE Default (Weak, Offensive, Defensive),
  Becai, Greedy, Rookie, Passive, Monte Carlo. With several humans, the screen is handed over
  between them every turn.
- **KDE's rules**: cumulative production, production after conquest, neutral production, and an
  optional turn limit (KDE has none).
- **KDE's display options**: blind map (other players' ships and fleets hidden), and whether
  neutral planets show their ships and their stats.

The game saves itself after every turn. The rules are inside the game, under **How to play**,
and in [Docs/Games/Konquest.md](Docs/Games/Konquest.md).

