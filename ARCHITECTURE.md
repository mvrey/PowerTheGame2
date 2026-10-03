# Architecture: engine, API, bots and hosts

Anyone can write a bot (an AI opponent) without touching the engine or the interface, and run it
in the browser game, in headless tournaments, or as a separate program that plays over HTTP.
This document explains how the pieces fit together; how to write a bot is in `BOTS.md`.

## 1. Layering

```
            ┌───────────────┐   ┌──────────────────┐   ┌─────────────────┐
            │    src/ui     │   │   src/server     │   │ tools/, src/cli │
            │ browser host  │   │ HTTP transport   │   │ arena, remote   │
            └──────┬────────┘   └────────┬─────────┘   └───────┬─────────┘
                   │      uses           │                     │
            ┌──────▼─────────────────────▼─────────────────────▼─────────┐
            │  src/bots     registry + bot implementations (generals,    │
            │               examples). Bots import ONLY from src/api.    │
            └──────────────────────────┬─────────────────────────────────┘
            ┌──────────────────────────▼─────────────────────────────────┐
            │  src/api      public API of the engine:                    │
            │   Match (authoritative session: views, submit, resolve)    │
            │   GameClient (what a bot talks to) + Local/Http clients    │
            │   Bot contract, driver (runs a bot through a client)       │
            │   toolkit: Board queries, OrderSheet, legalOrders, simulate│
            └──────────────────────────┬─────────────────────────────────┘
            ┌──────────────────────────▼─────────────────────────────────┐
            │  src/engine   pure rules: maps, board graph, orders,       │
            │               round resolution. Internal: only src/api     │
            │               imports it.                                  │
            └────────────────────────────────────────────────────────────┘
```

Rule enforced by a test (`tests/architecture.test.ts`): nothing outside `src/engine` and
`src/api` imports `src/engine`; bots import nothing but `src/api`.

## 2. Key abstractions

| Piece | Responsibility (SRP) | Notes |
|---|---|---|
| `engine/board.ts` `Board`, `getBoard(id)` | Immutable board graph of one map, cached by id | Also the army ids and move ranges |
| `engine/game.ts` | New games, read-only queries (strength, allowance, seating...) | Queries accept a `ReadonlyGameState` |
| `engine/rules.ts`, `engine/resolve.ts` | Validate/apply an order; resolve a round | |
| `api/match.ts` `Match` | One game session: hands out `PlayerView`s, validates and stores submitted orders, resolves the round when told, notifies listeners | Host-side; never given to bots. Its `state` is deeply read-only |
| `api/view.ts` `PlayerView` | Plain JSON data a bot decides from: its seat, the full public state (a private copy), its armies and order allowance | Power is a perfect-information game: only orders are secret |
| `api/orderSheet.ts` `OrderSheet` | Builds an order list step by step: checks each order against the allowance and against the board as the earlier orders leave it; `addAll` / `checkOrders` judge a whole list | Used by the UI's order sheet, the driver, `Match.submit` and bots |
| `api/legal.ts` `legalOrders` | Enumerates every order that could be added to a sheet now | Makes simple bots trivial |
| `api/simulate.ts` `simulate` | "What if": plays a round on a copy of a state with the real rules | The generals use it to weigh plans |
| `api/random.ts` | Seedable random numbers; one stream per seat (`seatRng`) | Same seed, same game |
| `api/bot.ts` `Bot`, `BotDefinition` | The bot contract: `decide(view, ctx) → orders`; a definition creates bots for a level | |
| `api/client.ts` `GameClient` | What a bot talks to: `status`, `view`, `submit` | `LocalGameClient` (in process), `HttpGameClient` (server), interchangeable (LSP) |
| `api/driver.ts` `playTurn`, `playMatch` | Runs a bot through any client; contains bot failures (exceptions, illegal orders) so a buggy bot cannot break a game | |
| `api/protocol.ts` | JSON shapes of the HTTP API and `PROTOCOL_VERSION` | `GET /api` reports the version |
| `bots/registry.ts` `BotRegistry` | Lists and creates bots by id | Bots are discovered automatically from `src/bots/**/*.bot.ts` (OCP: drop a file, it appears in menus, arena and server) |
| `bots/generals/` | The generals: `planner.ts` (plan search), `tactics/` (the building blocks of a plan), `evaluate.ts` (position score, one function per term), `analysis.ts` (who could get where) | Written against `src/api` only |
| `server/matchService.ts` | Matches on a server: seats, tokens, server-side bots, auto-resolve, order timeout | Transport-free, testable |
| `server/http.ts` | JSON endpoints over `node:http` | Thin adapter over the service |
| `ui/game/gameScreen.ts` | Hosts a `Match` in the browser: phases, wiring, rendering order | A coordinator; the work is done by the modules below |
| `ui/game/planning.ts` | The human's order sheet and the clicks that build it | |
| `ui/game/aiSeats.ts` | The bots of the AI seats, thinking in time slices while the human plans | |
| `ui/game/playback.ts` | Animates a played round, one handler per event kind | |
| `ui/game/clock.ts`, `names.ts`, `dialogs.ts`, `panels/` | Clocks, wording, dialogs, and the panels around the board | |

SOLID in short: each module has one reason to change (S); new bots and transports plug in
without edits to the engine, UI or server (O); every `GameClient` and every `Bot` is
interchangeable (L); bots see a small `GameClient` / `PlayerView` / toolkit surface, not the
`Match` (I); bots, UI, server and tools depend on the `src/api` abstractions, never on engine
internals (D).

## 3. Decisions worth knowing

- **Views carry the whole state.** Power hides only the orders being written, so there is nothing
  to filter; a view is a deep copy, so bots cannot tamper with the game.
- **Read-only where it matters.** The live state (`Match.state`) and an order sheet's preview are
  typed `ReadonlyGameState`, so the compiler stops a host or a bot from changing them by accident.
- **Submissions are all or nothing** at the `Match` level (a clear contract for remote clients),
  while the bot driver is forgiving: it drops illegal orders, keeps the rest and reports them.
  A bot bug never stalls or crashes a game.
- **Bots are asynchronous and cooperative** (`await ctx.checkpoint()`), not run in a Web Worker:
  workers are unreliable from `file://`, which is how the game is distributed.
- **Stateless rules endpoints** (`/api/legal`, `/api/check`, `/api/simulate`) let bots in other
  languages use the real rules instead of reimplementing them.
- **The protocol is versioned.** Orders and events say what they are in `kind`; breaking
  changes bump `PROTOCOL_VERSION` and are listed in `BOTS.md`.
- **Saves** went from v2 to v3 (AI seats name a `bot` instead of a `general`); v2 saves and stored
  setups are migrated on load. A saved state holds no orders, so protocol changes need no migration.
