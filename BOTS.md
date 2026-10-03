# Writing bots for Power

A bot is an AI player. You can write one in TypeScript and drop it into the game (it shows up in
the menus next to the built-in generals), pit bots against each other in headless tournaments, or
write one in any language and have it play over HTTP.

The six generals (Kruger, Vega, Okoye, Ivanova, Tanaka, Dubois) are bots like any other, built on
exactly the API described here: see `src/bots/generals/`. How the pieces fit together is in
`ARCHITECTURE.md`.

## 1. A bot in five minutes

Create a file whose name ends in `.bot.ts` anywhere under `src/bots/`, for example
`src/bots/mine/turtle.bot.ts`:

```ts
import { OrderSheet, defineBot, legalOrders } from '../../api';

export default defineBot({
  id: 'turtle',                      // unique: lowercase letters, digits, dashes
  name: 'Turtle',                    // shown in the menus
  description: { en: 'Never leaves home', es: 'Nunca sale de casa' },
  levels: false,                     // hides the Recruit/Captain/General picker
  create: ({ level }) => ({
    decide(view, ctx) {
      const sheet = new OrderSheet(view.state, view.me);
      // Buy whatever Power allows and bring it home.
      for (const order of legalOrders(sheet)) {
        if (order.k === 'buy' || (order.k === 'move' && order.from === -1)) sheet.add(order);
      }
      return [...sheet.orders];
    },
  }),
});
```

That is all. There is nothing to register: every `*.bot.ts` file is discovered automatically.

- **Play against it**: `npm run dev`, New game, pick *Turtle* as a rival.
- **Tournament**: `npm run arena -- bots=turtle,okoye,kruger:3,rookie games=8`
- **Tests**: `npm test` already plays every registered bot through full games and fails if it
  gives an illegal order or throws (`tests/bots.test.ts`).

`src/bots/examples/` holds two complete, commented bots to copy from: **Rookie**
(`random.bot.ts`, random legal orders) and **Greedy** (`greedy.bot.ts`, one-round lookahead with
the real rules).

## 2. The contract

```ts
interface Bot {
  decide(view: PlayerView, ctx: BotContext): Order[] | Promise<Order[]>;
}
```

The host calls `decide` once per round and submits what it returns. One bot instance plays one
seat for one game, so it may keep memory between rounds in its own fields.

### What the bot sees: `PlayerView`

| Field | Meaning |
|---|---|
| `me` | Your player index |
| `round` | The round being planned |
| `state` | The whole game state (`GameState`). Power has no hidden information except the orders being written. It is your own copy: modify it freely. |
| `armies` | Your living armies (0 Green, 1 Blue, 2 Yellow, 3 Red) |
| `commandable` | Armies you may order: yours, plus the mercenary army in 3-player games |
| `maxOrders` | Orders allowed this round: 5 per living army of yours |
| `ordersPerArmy` | Most orders one of your armies may receive (5) |

`state` contains `pieces` (`{ id, type, army, loc }`, where `loc` is a board node or
`RESERVE` = -1), `armies` (`{ id, controller, alive, power, flags }`), `players`, `round`,
`referee` (who executes first), `mode` and `map`.

### What the host lends: `BotContext`

| Member | Use it for |
|---|---|
| `rng()` | Random numbers. Use it instead of `Math.random`: games become replayable from a seed. |
| `await checkpoint()` | Call it every few milliseconds of work in long computations. In the browser it lets the page breathe; it throws once the host has stopped waiting (game closed), which ends your computation cleanly. It is nearly free when no break is due. |
| `signal` | An `AbortSignal`, for code that prefers to poll `signal.aborted`. |

### Orders

| Order | Fields | Meaning |
|---|---|---|
| `move` | `army, type, from, to` | Move one piece. `from: -1` (the Reserve) deploys it to its HQ (`to` = that HQ). |
| `buy` | `army, type` | Buy a Soldier, Tank, Fighter or Destroyer (`S T F D`) with Power. It goes to the Reserve. |
| `up` | `army, type, at` | Trade three identical small pieces at `at` (a node or -1) for the big one. |
| `mk` | `army, at, spend, power` | Build a Megamissile from pieces at `at` (`spend: { S: 2, R: 1, ... }`) plus Power (Reserve only), worth 100 or more. |
| `launch` | `army, from, target, targetArmy` | Launch a Megamissile at a node (`targetArmy: -1`), or at an army's Reserve (`target: -1`). |

Piece types: `S` Soldier, `T` Tank, `F` Fighter, `D` Destroyer, `R` Regiment, `H` Heavy tank,
`B` Bomber, `C` Cruiser, `M` Megamissile. Their power and movement are in `PIECES`.

Orders are executed in sequence, so later orders may rely on earlier ones (buy a Soldier, then
deploy it). If your list contains an illegal order the host drops it, keeps the rest, and reports
the problem; a bot that throws gives no orders that round. Giving no orders at all costs a Power,
as in the board game.

## 3. The toolkit

Import everything from `src/api` (bots may not import the engine directly; a test checks it).

| Tool | What it does |
|---|---|
| `boardOf(state)` / `getBoard(mapId)` | The board: `nodes` (`kind`, `army`, `num`, `coastal`), `hq[army]`, `territory[army]`, `adj`, `reach[cls][from]` (one move), `rounds[cls][from][to]` (moves needed), `canReach(cls, from, to)` |
| `new OrderSheet(state, me)` | Builds an order list: `check(order)` says why an order would fail, `add(order)` adds it if legal, `preview` is the board as your orders so far leave it, `left(army)`, `full`, `removeAt(i)` |
| `legalOrders(sheet)` | Every order that could be added to the sheet now |
| `simulate(state, ordersByPlayer)` | Plays a round on a copy with the real rules: `{ state, events }` |
| `checkOrders(state, me, orders)` | Problems in a whole order list |
| `cheapestMissileSpend(state, army, at)` | The cheapest way to build a Megamissile there |
| `piecesAt`, `powerOf`, `enemyPowerAt`, `powerByTeam` | What stands on a node |
| `armyStrength`, `playerStrength`, `livingArmies`, `teamOf`, `executionOrder` | Who is strong, who is alive, who acts first |
| `PIECES`, `GROUP1`, `RESERVE`, `MERC`, `MISSILE_COST`, `ORDERS_PER_ARMY` | Rules constants |

Classes of movement are `inf` (Soldier, Regiment), `tank`, `air` and `naval`; `PIECES[type].cls`
gives a piece's class (`null` for the Megamissile).

## 4. Testing a bot

Play whole games without any interface:

```ts
import { Match, runHeadless } from '../src/api';
import { bots } from '../src/bots';

const match = Match.create({ map: 'classic', mode: 4, players: [0, 1, 2, 3].map((a) => ({ name: 'P' + a, armies: [a] })) });
const players = ['turtle', 'okoye', 'kruger', 'vega'].map((id) => bots.create(id, { level: 2 }));
const end = await runHeadless(match, players, { seed: 1, maxRounds: 80, onProblem: (player, p) => console.log(player, p) });
console.log(end.winners);
```

Or use the arena, which rotates seats between games and reports wins, strength and thinking time:

```
npm run arena -- bots=turtle,okoye:3,kruger,vega games=10 map=ring rounds=80 seed=1 verbose
```

`bots` takes 2 to 4 ids (with `:level`); their number sets the mode (2: two allied armies each,
3: the fourth army is mercenary).

## 5. Bots in other programs, over HTTP

`npm run server` (optionally `-- port=8787`) starts a server that hosts matches. A seat is either
played on the server by a registered bot or left to a remote program, which receives a secret
token for it. A round is played as soon as every living player has handed in orders (or when the
optional order timeout expires).

### Endpoints

All bodies are JSON. `GET /api` lists them too.

| Endpoint | |
|---|---|
| `GET /api/bots` | Bots that can play server-side seats |
| `GET /api/maps`, `GET /api/maps/:id` | Map ids; a board as JSON (`nodes`, `hq`, `territory`, `adj`, `reach`, `rounds` with `null` for unreachable) |
| `POST /api/matches` | Create a match. Body: `{ map?, mode?, seats: [{ name?, armies?, bot?, level? }], maxRounds?, orderTimeoutMs?, seed? }`. Seats without `bot` are remote; the answer gives their `token`s. |
| `GET /api/matches` | All matches |
| `GET /api/matches/:id` | Status: `round`, `over`, `winners`, `waitingFor`, `players`. With `?after=N` it waits (up to 25 s) until round N has been played. |
| `GET /api/matches/:id/view?player=N` | The `PlayerView` for the round being planned |
| `POST /api/matches/:id/orders` | Body `{ player, orders }`, header `Authorization: Bearer <token>`. Answer: `{ accepted, reason?, problems }`. All or nothing; you may resubmit until the round is played. |
| `GET /api/matches/:id/rounds?since=N` | What happened in every round after N: orders and events |
| `POST /api/legal` | `{ state, player, orders? }` → every order that could be added after `orders` |
| `POST /api/check` | `{ state, player, orders }` → the problems in an order list |
| `POST /api/simulate` | `{ state, orders: Order[][], lastRound? }` → `{ state, events }` |

The last three need no match: they let a bot in any language use the real rules without
reimplementing them.

### The loop of a remote bot

```
status = GET /api/matches/:id
while not status.over and status.players[me].alive:
    if me in status.waitingFor:
        view = GET /api/matches/:id/view?player=me
        POST /api/matches/:id/orders  { player: me, orders: decide(view) }
    status = GET /api/matches/:id?after=status.round
```

`examples/http_bot.py` is a complete bot in Python with nothing but the standard library:

```
npm run server
python examples/http_bot.py --server http://localhost:8787 --vs kruger:1,vega:1,rookie
```

From TypeScript the same thing is one call, because `HttpGameClient` implements the same
`GameClient` interface as the in-process client:

```ts
import { HttpGameClient, createRemoteMatch, playMatch } from './src/api';

const match = await createRemoteMatch('http://localhost:8787', { seats: [{ name: 'Me' }, { bot: 'kruger' }, { bot: 'vega' }, { bot: 'rookie' }] });
const client = new HttpGameClient('http://localhost:8787', match.id, 0, match.seats[0].token!);
const end = await playMatch(myBot, client);
```

`npm run bot -- server=http://localhost:8787 bot=greedy vs=kruger:2,vega,rookie` does exactly
that with any registered bot, and `match=… player=… token=…` joins an existing match instead.
