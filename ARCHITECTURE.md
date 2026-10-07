# Architecture

A platform for recurring bot-programming jams. Each edition brings a game; the referee, the bot
runner and sandbox, the replays, the tournament and the spectator viewer stay the same. Edition 1
is **Power**.

## 1. Layers

```
 composition roots     src/jam/ (the `jam` CLI)                 src/viewer/ (spectator app)
                              │  knows the platform and the games      │
 ─────────────────────────────┼─────────────────────────────────────────┼──────────────
 games                 src/games/index.ts, viewers.ts  (registries: one line per game)
                       src/games/power/   engine → api → bots, module, play (browser game), viewer
                              │  uses only the platform's contract (core) and web helpers
 ─────────────────────────────┼─────────────────────────────────────────────────────
 platform              src/platform/core/  game contract, protocol, referee, replays + verifier,
                                           tournament logic, viewer contract   (portable, pure)
                       src/platform/node/  runners (local, Docker, in-process), framing with limits,
                                           manifests, zip unpacking, tournament executor, file server
                       src/platform/web/   DOM helpers shared by the viewer and the games' UIs
 outside the process   sdk/ (protocol helpers for bots), templates/ (starter bots), sandbox/docker/
```

`tests/architecture.test.ts` enforces the arrows: the platform never imports a game; games never
import `platform/node`, the CLI or the viewer; `platform/core` and the game logic use no Node
modules and no DOM, so they run in Node and in the browser alike (the viewer verifies replays
with the same code as the CLI).

## 2. A match, end to end

```
 jam match / jam tournament
   └─ runner.launcher(bot) ── spawns the bot: docker run … (official) | local process | in-process built-in
   └─ referee (runMatch)
        hello ─► ready              per seat, with startup deadline
        loop: game.toAct → game.observe → turn ─► action   (in parallel, with deadlines)
              actionsOf(game.parseAction | game.noAction) → game.resolve → record turn + state hash
        end ─► close (grace, then kill) → diagnostics (exit, stderr up to a limit, failure counts)
   └─ Replay (JSON): setup, seeds, bot versions, raw answers, failures, timings, events, hashes, result
 jam verify / the viewer
   └─ verifyReplay: plays the raw answers through the game again; same problems, events, states, result
```

The referee is the only code that sees a bot's output. It turns every misbehaviour into a
recorded failure and the game's "no action" (`Docs/Protocol.md`), so a bot can never stop a match.

## 3. Contracts

| Contract | File | What it decouples |
|---|---|---|
| `GameModule<State, Action, Event>` | `platform/core/game.ts` | The referee, verifier and tournament from any game. Deterministic, pure functions: `setup`, `toAct`, `matchInfo`, `observe`, `parseAction`, `noAction`, `resolve`, `result`. |
| `GamePackage` | `platform/core/bots.ts` | What an edition ships: the module, built-in bots, starter templates, defaults. |
| Protocol v1 | `platform/core/protocol.ts`, `Docs/Protocol.md` | Bots in any language from the platform: JSON lines over stdio. |
| `BotConnection` / `Runner` | `platform/core/referee.ts`, `platform/node/runners.ts` | The referee from how bots are hosted (sandbox, local, in-process). |
| `Replay` | `platform/core/replay.ts` | Recording from reproduction and display. |
| `WorldCupConfig` → `planTournament` | `platform/core/tournament/` | The tournament state is a pure function of config, seed and results: resumable, auditable. |
| `ViewerPlugin` / `ReplayRenderer` | `platform/core/viewer.ts` | The viewer's timeline, tables and broadcast mode from how a game draws a position. |

## 4. Decisions worth knowing

- **One process per bot per match**, with the full state in every observation: no startup cost
  per turn, and memory within a match is allowed but never needed (Design §5, Option B).
- **Seats are anonymous** inside the game: no opponent-specific hardcoding.
- **Replays store raw answers, not observations.** Observations can be recomputed, and parsing them
  again checks the parser too. Hashes of every state catch any divergence.
- **The viewer recomputes positions** from the replay through the game module, so the replay
  stays small. It never decides anything: it verifies the replay and shows the recorded result.
- **Built-in bots run in-process** (trusted organizer code). Participants' code never does.
- **No build step for bots** (Python and JavaScript, standard library only): nothing to compile,
  nothing to download, no build-time attack surface. Compiled languages would add a restricted
  build stage before the runner (future work).
- **Power's browser game** (`src/games/power/play`) stays: participants can play the game they
  are writing bots for, against the built-in generals.

## 5. Adding a game (next edition)

1. `src/games/<game>/`: the rules (keep them pure and deterministic), and a `module/` implementing
   `GameModule` + a `GamePackage` (formats with a 2-player one for duels; variants; defaults; a
   sparring built-in bot).
2. The JSON your bots see and send: document it in `Docs/Games/<Game>.md` and bump the game's
   `version` whenever it changes.
3. `sdk/python/<game>.py`, `sdk/javascript/<game>.mjs` and `templates/<game>/{python,javascript}`
   with a working starter bot (the test checks the templates carry the current SDK files).
4. A `viewer/` implementing `ViewerPlugin` (draw a position, animate a turn, describe the seats).
5. Register it: one line in `src/games/index.ts`, one in `src/games/viewers.ts`, and its layers in
   `tests/architecture.test.ts`.
6. Tests: rules, the module (parse, placements, a full match with a verified replay), and
   `npm run research` for balance and the generic-baseline check (Design §2).

Nothing in `src/platform`, `src/jam` or `src/viewer` should need to change. If something does,
the contract is missing a hook: add it to the contract, not to the platform code.

## 6. Power (edition 1) inside

`engine` (rules, maps as text grids) ← `api` (Match, OrderSheet, legalOrders, simulate, the TS bot
contract) ← `bots` (the generals: a planner over tactics with simulation; examples; the Monte Carlo
baseline) ← `module` (the GameModule: anonymous seats, observations with the legal first orders and
the previous round, placements by survival and material) and `play` (the browser game) and
`viewer` (the renderer, reusing the game's board, army cards and round animation).
