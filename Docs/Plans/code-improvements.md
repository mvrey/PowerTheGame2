# Code review: areas of improvement (2026-10-03)

Scan of `src/`, `tools/` and `tests/` against CLAUDE.md (clean code, SOLID, DRY, readable,
self-documenting). Baseline when scanned: `tsc` clean, 114/114 tests green, and enabling
`noUnusedLocals` + `noUnusedParameters` reports nothing.

Nothing here is executed yet. Items are grouped by priority; each lists the problem, where it
lives and the proposed fix.

---

## P0: before touching anything

1. **~600 changed lines are uncommitted.** The whole pluggable-bots refactor (renames
   `src/ai` → `src/bots/generals`, new `src/api`, `src/server`, tools, tests) is only in the
   working tree. Commit it first so every refactor below is a small, reviewable diff.

---

## P1: Single Responsibility (files far over a few hundred lines)

### 1. `src/ui/gameScreen.ts`: 1139 lines, one class, ~10 responsibilities
It hosts the match, runs the bots, owns the clocks and pause, handles board clicks, the
popover and the missile dialog, renders five panels, animates the round playback, writes the
log, plays audio, and builds the pause, eliminated and game-over dialogs.

Proposed split (GameScreen becomes a thin coordinator):

| New module | Takes over |
|---|---|
| `ui/game/names.ts` | `place`, `playerName`, `subject`, `ownerName`, `armyTitle`, `orderText`, `orderIcon` (pure, testable) |
| `ui/game/clock.ts` | `tick`, `pause`/`resume`, order timer, game limit, `isLastRound` |
| `ui/game/planning.ts` | `sel`, `targeting`, `onNode`, `openNode`, popover, `tryAdd`, `removeOrder`, keyboard shortcuts |
| `ui/game/missileDialog.ts` | `openMissileDialog` (~50 lines, self-contained) |
| `ui/game/panels/*.ts` | `renderCards`, `renderSheet`, `renderHeader`, `renderLog`, tooltip (`onHover`) |
| `ui/game/playback.ts` | `playback` plus `fly`, `without`, `bubble`, `point`. The 150-line `switch` becomes a map of one handler per `RoundEvent` type |
| `ui/game/dialogs.ts` | `openPause`, `showEliminated`, `showGameOver`, `seatAll` |
| `ui/game/seats.ts` | bot creation, `startAi`, autoplay |

### 2. `src/bots/generals/planner.ts`: 496 lines
It mixes random helpers, nine tactics ("macros") and the plan search.
- Move `pick` / `shuffled` to `bots/generals/random.ts`.
- Move the macros to `bots/generals/tactics/` (one file per tactic, or grouped
  offence/defence/economy) and keep `planner.ts` for `buildPlan`, `context`, `plan`, `PlannerBot`.
- **Repeated logic:** `income`, `advance`, `march` and `retreat` all score destinations with
  the same steps (`strength = power(p) + myPowerAt(...)`, skip it if `hostile(power) >= strength`,
  `safe = hostile(pot) <= strength`, then keep the best score). Extract `assessDestination(c, d, p, to)`
  and an `argmax(items, score)` helper. Note that `fallback` and `missile` also pick the best by hand.
- **Names:** the parameters `c` and `d` appear in every function (`d` is an OrderSheet, left over from
  "draft"), along with `an`, `pot` and `inf`. Rename them to `ctx`, `sheet`, `analysis`, `potential`
  and `canBringInfantry`.

### 3. Long functions
- `bots/generals/evaluate.ts` `evaluate()` (~85 lines): six scoring terms in one body.
  Split it into named terms (`material`, `tradeUpPairs`, `flagSafety`, `exposure`, `income`,
  `flagsInGrasp`) and add them up.
- `ui/geometry.ts` `build()` (~125 lines): extract `cellPolygon`, `nodeShape`, `bridges`, `voids`.

---

## P2: DRY (the same knowledge in several places)

| Duplicated knowledge | Where | Fix |
|---|---|---|
| Order allowance `livingArmies(..).length * ORDERS_PER_ARMY` | `engine/game.ts` (`withinBudget`, `ordersLeft`), `api/orderSheet.ts` (`max`), `api/view.ts`, `ui/gameScreen.ts` (`maxOrders`), `bots/generals/analysis.ts` | One `orderAllowance(state, player)` in the engine. The UI uses `sheet.max` / `sheet.full` |
| Check a list of orders in sequence | `api/simulate.ts` `checkOrders` and `api/driver.ts` `playTurn` (same loop) | One `filterLegal(state, player, orders) → { sheet, problems }`. `checkOrders` moves out of `simulate.ts` (it has nothing to do with simulating) |
| Per-seat RNG seeding, with **three different formulas** | `api/headless.ts`, `server/matchService.ts` (`seed*7919 + p*104729`), `ui/gameScreen.ts` (`seed + p*7919`) | `seatRng(seed, player)` in the API |
| Default army split per mode | `server/matchService.ts` `DEFAULT_ARMIES`, `tools/arena.ts`, `tests/helpers.ts` `seats`, `ui/menus.ts` `build` (rotated by colour) | `defaultSeating(mode, firstArmy = 0)` in the API |
| Army strength | `engine/game.ts` `armyStrength` and `ui/gameScreen.ts` `strengthOf` (on a Snapshot) | One function that takes `{pieces, power}` |
| "Is there any legal order?" | `ui/gameScreen.ts` `hasAnyLegalOrder` re-implements the rules | `legalOrders(sheet).length > 0` |
| Movement ranges `{inf:2, tank:3, air:5, naval:1}` | `engine/board.ts` `RANGE` and `ui/menus.ts` `rulesModal` | Export `RANGE` through the API |
| Order timer minutes `mode === 2 ? 6 : 3` | `ui/gameScreen.ts`, `ui/menus.ts` | One `orderTimerMinutes(mode)` |
| "Is a big piece" | `ui/icons.ts` `isBig` hardcodes `R,H,B,C,M` | Derive it from `PIECES[type].group !== 1` |
| Number of armies hardcoded as `4` / `[0,1,2,3]` / `% 4` / `a > 3` | `engine/board.ts`, `ui/geometry.ts`, `ui/boardView.ts` (×3), `ui/menus.ts` (×3), `server/matchService.ts` | `NUM_ARMIES` and an `ARMIES` list |
| Fallback bot `'okoye'` | `ui/gameScreen.ts` (×2), `tools/remote-bot.ts` | `DEFAULT_BOT_ID` exported by `src/bots` |
| `key=value` argument parsing | `server/main.ts` has its own; `tools/args.ts` already does it | Reuse `parseArgs` |
| `mode: 2 \| 3 \| 4`, `[1,2,3].includes(level)` | about 10 places | `type Mode`, plus `isMode` / `isBotLevel` guards |

---

## P3: Correctness and robustness

1. **Missing translation crashes the setup screen.** `t()` calls `.replace` on the table
   entry, and keys are built dynamically with casts (`('map.' + id) as Key`). Adding a map
   to `MAPS` without `map.<id>` and `map.<id>.text` keys compiles but throws at runtime. Fix:
   a test that every map id, army, piece and `OrderError` has a key in both languages,
   plus typed key builders (`` `map.${MapId}` ``) instead of casts.
2. `api/match.ts` `structuredCopy` is a JSON round-trip whose name suggests the platform's
   `structuredClone`. Use `structuredClone`, or rename it to `jsonCopy`.
3. `Match.state` returns a shallow `Readonly<GameState>` with the comment "never modify it". Nested
   arrays can still be changed. `DeepReadonly` would make the type enforce the comment.

---

## P4: Readability

1. **Cryptic discriminants** in the public types: `Order.k` with `'mk'` and `'up'`, and `RoundEvent.t`.
   Bots read these, and so does `examples/http_bot.py` over HTTP, so renaming them (`kind`,
   `'makeMissile'`, `'tradeUp'`) is a **breaking protocol change**. Rename only together with a protocol
   version bump. Otherwise keep them and document the meanings at the type.
2. **SCREAMING_CASE locals** left over from the old global-board days: `evaluate.ts`
   (`HQ`, `NODES`, `NUM_NODES`, `ROUNDS`) and `geometry.ts` (`GRID`, `MAP`, `NODES`).
3. **Magic weights** in `evaluate.ts` and the planner macros (0.9, 0.04, 45, 400, 1.15...).
   Give the main ones names, or comment them where they are tuned.

---

## P5: Tooling

1. Set `noUnusedLocals: true` and `noUnusedParameters: true` in `tsconfig.json`. Both pass today,
   so this costs nothing.
2. Add ESLint (typescript-eslint) + Prettier so the conventions above are enforced, not remembered.
3. CLAUDE.md asks for plans in `Docs/Plans/`, but the previous plans are `PLAN.md` and the
   plan half of `ARCHITECTURE.md` at the root. Consider moving the plan parts here.

---

## Suggested execution order

P0 → P5.1 → P2 (small, safe and test-covered) → P3.1 → P1.2 (planner) → P1.1 (game screen,
largest, verify in the browser with `#autoplay`) → P1.3 → P4.2/P4.3 → P4.1 (only if a
protocol version bump is accepted). Run `npm run typecheck && npm test` after every step,
and also `npm run build` plus a browser game after the UI steps.
