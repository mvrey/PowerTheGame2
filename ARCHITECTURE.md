# Architecture: engine, API and bots

This document is both the plan for the "pluggable bots" refactor and the description of the
result. The goal: anyone can write a bot (an AI opponent) without touching the engine or the
interface, and run it in the browser game, in headless tournaments, or as a separate program
that plays over HTTP.

## 1. Starting point and problems

- `src/engine` was already pure, but the board was **global mutable state** (`useMap()` swapped
  module-level bindings). Two games on different maps could not coexist (a server could not host
  them), and every caller depended on "whichever map was set last".
- The AI (`src/ai`) reached into engine internals (`checkOrder`, `applyOrder`, `resolveRound`,
  `cloneState`, globals). A new AI would have had to do the same.
- The UI drove everything by hand: called the planner's generator, collected plans, called
  `resolveRound`. Adding an opponent type meant editing the game screen and the menus.
- The engine's `Player` knew about the UI (`kind: 'human' | 'ai'`, `general`, `level`).

## 2. Target layering

```
            ┌───────────────┐   ┌──────────────────┐   ┌─────────────────┐
            │    src/ui     │   │   src/server     │   │     tools/      │
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

## 3. Key abstractions

| Piece | Responsibility (SRP) | Notes |
|---|---|---|
| `engine/board.ts` `Board`, `getBoard(id)` | Immutable board graph of one map, cached by id | Replaces the global `useMap` state |
| `engine/*` | Rules: validate/apply an order, resolve a round | Unchanged behaviour |
| `api/match.ts` `Match` | One game session: hands out `PlayerView`s, validates and stores submitted orders, resolves the round when told, notifies listeners | Host-side; never given to bots |
| `api/view.ts` `PlayerView` | Plain JSON data a bot decides from: its seat, the full public state (a private copy), its armies and order allowance | Power is a perfect-information game: only orders are secret |
| `api/orderSheet.ts` `OrderSheet` | Builds an order list step by step: checks each order against the budget and against the board as the earlier orders leave it | Used by the UI's order sheet and by bots |
| `api/legal.ts` `legalOrders` | Enumerates every order that could be added to a sheet now | Makes simple bots trivial |
| `api/simulate.ts` `simulate` | "What if": plays a round on a copy of a state with the real rules | The generals use it to weigh plans |
| `api/bot.ts` `Bot`, `BotDefinition` | The bot contract: `decide(view, ctx) → orders`; a definition creates bots for a level | |
| `api/client.ts` `GameClient` | What a bot talks to: `status`, `view`, `submit` | `LocalGameClient` (in process), `HttpGameClient` (server) — interchangeable (LSP) |
| `api/driver.ts` `playTurn`, `playMatch` | Runs a bot through any client; contains bot failures (exceptions, illegal orders) so a buggy bot cannot break a game | |
| `bots/registry.ts` `BotRegistry` | Lists and creates bots by id | Bots are discovered automatically from `src/bots/**/*.bot.ts` (OCP: drop a file, it appears in menus, arena and server) |
| `server/matchService.ts` | Matches on a server: seats, tokens, server-side bots, auto-resolve, order timeout | Transport-free, testable |
| `server/http.ts` | JSON endpoints over `node:http` | Thin adapter over the service |

SOLID in short: each module has one reason to change (S); new bots and transports plug in
without edits to the engine, UI or server (O); every `GameClient` and every `Bot` is
interchangeable (L); bots see a small `GameClient` / `PlayerView` / toolkit surface, not the
`Match` (I); bots, UI, server and tools depend on the `src/api` abstractions, never on engine
internals (D).

## 4. Plan (executed in this order)

1. **Engine**: `Board` objects instead of globals; `Player` loses `kind/general/level`;
   resolution can emit events without snapshots. Engine tests follow.
2. **API** (`src/api`): view, OrderSheet, legalOrders, simulate, Match, GameClient + local
   client, driver, bot contract, public `index.ts`.
3. **Bots**: the planner becomes `PlannerBot`, written against `src/api` only; the six generals
   become bot definitions; two example bots (random, greedy); registry with auto-discovery.
4. **UI**: the game screen hosts a `Match`; AI seats are bots run by the driver with
   time-sliced checkpoints; the human's sheet is an `OrderSheet`; menus list the registry.
   Saves migrate from v2.
5. **Server**: `MatchService` + HTTP endpoints + `HttpGameClient`; `npm run server`.
6. **Tools**: `npm run arena` (headless tournaments between any bots), `npm run bot`
   (connect a bot to a server match).
7. **Tests**: API (match, sheet, legal, simulate, driver), bots (all registered bots play legal
   games), server end-to-end over HTTP, architecture boundaries; existing tests kept.
8. **Docs**: `BOTS.md` (how to write a bot, HTTP reference), README, this file.
9. **Verify**: typecheck, tests, production build, browser game played end to end.

## 5. Status

All steps above are done (2026-10-03). Verified with:

- `npm run typecheck` and `npm run build` (the browser build stays a single self-contained file;
  the server is not part of it).
- `npm test`: engine rules, API (Match, OrderSheet, legalOrders, simulate, clients), every
  registered bot playing full legal games, the generals beating the recruit, the driver containing
  faulty bots, the HTTP server end to end, and the import boundaries above.
- The browser game driven in Chrome: menus listing registry bots, a migrated v2 save continued,
  orders given by clicking, full games with generals and example bots, elimination and instant
  finish, no console errors.
- `npm run server` with `npm run bot` and with `examples/http_bot.py` (Python, standard library
  only) playing complete matches.

## 6. Decisions worth knowing

- **Views carry the whole state.** Power hides only the orders being written, so there is nothing
  to filter; a view is a deep copy, so bots cannot tamper with the game.
- **Submissions are all or nothing** at the `Match` level (a clear contract for remote clients),
  while the bot driver is forgiving: it drops illegal orders, keeps the rest and reports them.
  A bot bug never stalls or crashes a game.
- **Bots are asynchronous and cooperative** (`await ctx.checkpoint()`), not run in a Web Worker:
  workers are unreliable from `file://`, which is how the game is distributed.
- **Stateless rules endpoints** (`/api/legal`, `/api/check`, `/api/simulate`) let bots in other
  languages use the real rules instead of reimplementing them.
- **Saves** went from v2 to v3 (AI seats name a `bot` instead of a `general`); v2 saves and stored
  setups are migrated on load.
