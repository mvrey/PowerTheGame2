# Edition 1: Power

Power (1981) is a game of simultaneous orders on a board of four territories, islands and sea
lanes. There is no chance, and nothing is hidden except the orders being written. It is simple to
learn and hard to master, and no published engine or strategy exists for it.

- Game id `power`, version `2.0.0` (sent in `hello.game`, recorded in every replay).
- Formats: `duel` (2 seats, two allied armies each), `ffa3` (3 seats; the fourth army is
  mercenary and anyone may order it), `ffa4` (4 seats, one army each).
- Maps (`hello.match.variant`): `classic`, `continent`, `ring`, `crossroads`, `archipelago`.
- The full rules and the nine points where the rulebook is not explicit: `PLAN.md` (Spanish).
  The rules as code: `src/games/power/engine`.

## 1. Rules in one page

**Pieces.** Power on the board is what fights. Three small pieces of a kind trade up for the big one.

| Piece | Power | Moves | Moves on | 3 → | Power |
|---|---|---|---|---|---|
| Soldier `S` | 2 | 2 | land | Regiment `R` | 20 |
| Tank `T` | 3 | 3 | land | Heavy tank `H` | 30 |
| Fighter `F` | 5 | 5 | land, islands (not the sea) | Bomber `B` | 25 |
| Destroyer `D` | 10 | 1 | sea lanes, coastal sectors, islands, HQs | Cruiser `C` | 50 |
| Megamissile `M` | 0 | — | built from 100+ Power of pieces (and Power units in the Reserve) | | |

Land units stop when they enter an island or an HQ. Pieces never block each other's path. The
exact moves per piece are precomputed in `hello.info.board.reach` and `rounds`.

**A round** (one turn of the protocol):
1. **Orders**, secretly and all at once: at most 5 per living army you command (10 in a duel).
   They are executed in the order you list them, so later orders can rely on earlier ones (buy a
   Soldier, then deploy it). Kinds: `move` one piece (a Reserve piece goes to its HQ), `buy` a
   small piece with Power units, `tradeUp` three small pieces, `makeMissile`, `launch` a missile.
   A piece moves at most once per round. **Giving no valid order costs one Power unit.**
2. **Execution**, in seat order starting with the referee (a role that rotates every round).
3. **Missiles** land together, after all movement: everything at the target is destroyed.
4. **Conflicts.** Each space's power is added up by player. Ties first: the tied pieces that just
   moved in bounce back where they came from (once per round). Then the strongest side captures
   every other piece there, which goes to the captor's Reserve.
5. **Income:** 1 Power unit per enemy territory you occupy (the flag owner must still be alive).
6. **Flags:** standing alone on an enemy HQ with at least one Soldier or Regiment captures its flag.
   That army is eliminated, and its pieces and Power become yours.

**End.** The last player with a flag wins. At the round limit (`maxRounds`, 60 by default), the
most total material wins, then the most flags. Equal is a draw.

## 2. What your bot receives

### `hello.info`
```jsonc
{
  "board": {
    "id": "classic",
    "rows": ["HQG S6 S6 ...", "..."],          // the map as a text grid
    "nodes": [{ "idx": 0, "id": "G0", "kind": "sector", "army": 0, "num": 0, "coastal": false }, ...],
    "hq": [36, 37, 38, 39],                    // hq[army] = node index (classic map)
    "territory": [[0, 1, ...], ...],           // territory[army] = its sectors
    "adj": [[...], ...],                       // adjacency
    "reach": { "inf": [[...]], "tank": [[...]], "air": [[...]], "naval": [[...]] },   // one move
    "rounds": { "inf": [[0, 1, null, ...]], ... }   // moves needed between any two nodes (null = never)
  },
  "pieces": { "S": { "power": 2, "cls": "inf", "group": 1, "up": "R" }, ... },
  "rules": { "missileCost": 100, "ordersPerArmy": 5, "reserve": -1, "mercenary": -1,
             "moveRange": { "inf": 2, "tank": 3, "air": 5, "naval": 1 } },
  "you": 0,
  "seats": [{ "armies": [0, 1] }, { "armies": [2, 3] }],
  "maxRounds": 60
}
```
Armies: 0 Green, 1 Blue, 2 Yellow, 3 Red. Seats are anonymous ("Player 1", "Player 2").

### `turn.observation`
```jsonc
{
  "round": 3, "maxRounds": 60, "you": 0,
  "armies": [0, 1],                 // your living armies
  "commandable": [0, 1],            // + the mercenary army in ffa3
  "maxOrders": 10, "ordersPerArmy": 5,
  "state": {                        // the whole game: Power hides nothing but orders
    "pieces": [{ "id": 7, "type": "S", "army": 0, "loc": 36, "moved": false, ... }],   // loc -1 = Reserve
    "armies": [{ "id": 0, "controller": 0, "alive": true, "power": 3, "flags": [0] }, ...],
    "players": [...], "round": 3, "referee": 1, ...
  },
  "legal": [ /* every order that could be given FIRST this round */ ],
  "previous": {                     // null in round 1
    "round": 2,
    "orders": [[...], [...]],       // what everyone ordered (orders are public once played)
    "events": [ /* turn, order, penalty, strike, bounce, standoff, battle, income, flag, out, end */ ],
    "problems": [{ "code": "unreachable", "index": 3 }]   // what was refused in YOUR orders
  }
}
```
`legal` lists every order that is valid on its own at the start of the round. Once you add an
order, others become valid or invalid (you cannot move the same piece twice; a piece you buy
can then be deployed).

## 3. What your bot answers

```json
{ "orders": [
  { "kind": "move", "army": 0, "type": "S", "from": 36, "to": 8 },
  { "kind": "buy", "army": 1, "type": "T" },
  { "kind": "move", "army": 1, "type": "T", "from": -1, "to": 37 },
  { "kind": "tradeUp", "army": 0, "type": "S", "at": -1 },
  { "kind": "makeMissile", "army": 0, "at": -1, "spend": { "D": 5, "F": 10 }, "power": 0 },
  { "kind": "launch", "army": 0, "from": -1, "target": 30, "targetArmy": -1 }
] }
```
- `move` from `-1` (the Reserve) deploys to the army's HQ: `to` must be that HQ.
- `launch` at a Reserve: `"target": -1, "targetArmy": <army>`.
- Orders are checked one by one, in order. **Illegal ones are dropped and the rest are kept.** The
  next observation's `previous.problems` says which and why. At most 100 orders are read.

Refusal codes: `dead` (army eliminated), `notYours`, `noPiece`, `cantMove` (already moved,
or just traded up), `unreachable`, `onlyHQ`, `noPower`, `badType`, `needThree`, `tooWeak`,
`badSpend`, `noMissile`, `badTarget`, `budget` (over the allowance), `cancelled` (contradictory
mercenary orders), `malformed`, `tooMany`.

## 4. How a match is ranked
The winner (or winners, on a draw) ranks 1st. The others are ranked by how long they lasted
(a player still alive at the round limit outlasts anyone eliminated), then by final material.
The `score` of a placement is the final material: the tournament's material tiebreak uses it.

## 5. Starter kits and helpers
`npm run jam -- new python mybot` (or `javascript`) creates a working bot to start from. It contains
`jam.py`/`jam.mjs` (the protocol) and `power.py`/`power.mjs` (board queries, order builders).

## 6. Built-in bots
Reference opponents, written in TypeScript against Power's API (`src/games/power/bots`), run
inside the referee (they are trusted): `builtin:<id>`.

| Id | What it is |
|---|---|
| `kruger`, `vega`, `okoye`, `ivanova`, `tanaka`, `dubois` (`:1`–`:3`) | The generals: a planner that builds candidate plans from tactics, imagines rival plans, and keeps the best plan after simulating them. Six temperaments, three levels. |
| `rookie` | Random legal orders. The sparring partner of `jam check`. |
| `greedy` | One-round lookahead that ignores the rivals. |
| `montecarlo` (`:1`–`:3`) | The generic baseline: random plans scored by simulation, with no strategy (see below). |

To add one, drop a `*.bot.ts` file in `src/games/power/bots/`: it is discovered automatically
(see `src/games/power/bots/examples/random.bot.ts`).

## 7. Is the game deep enough? (Phase-1 checks)
`npm run research` plays the checks Design.md §2 asks for. Results (12 games per line, 60 rounds,
maps classic/ring/continent, seats alternated):

| Check | Result |
|---|---|
| Seat balance, Okoye (Captain) against itself | seat 0: 6 won, 6 lost |
| Seat balance, Monte Carlo (level 2) against itself | seat 0: 4 won, 8 lost |
| Monte Carlo 1 vs Rookie (random) | 12 won |
| Monte Carlo 2 vs Greedy (one-round lookahead) | 4 won, 8 lost |
| Monte Carlo 2 vs Okoye 2 | 0 won, 12 lost |
| Monte Carlo 3 vs Okoye 3 | 0 won, 12 lost |

(2026-10-04, game 2.0.0. Not one of the 72 games was a draw.)

What this says:
- **No seat advantage shows.** 6–6 for the same general is as even as it gets. The 4–8 of the
  noisy Monte Carlo bot is within chance for 12 games (p ≈ 0.39). The official format swaps seats
  anyway.
- **A generic search does not take over.** Flat Monte Carlo with a material evaluation beats random
  play, but loses to a one-round heuristic and loses all 24 games to the hand-written generals.
  Those generals also simulate, but they search plans built from strategic ideas. Width (10 orders
  from hundreds of options), simultaneous moves and a 60-round horizon make blind sampling
  ineffective. Strategy plus search wins, which is what the jam should reward.
- **Matches are decisive**: no draws, so the 3/1/0 scoring rarely needs its tiebreaks.

Limits: 12 games per line is a smoke test, not proof. Before launch, run
`npm run research -- --games 60`, and try a stronger generic approach (an MCTS with a tuned
evaluation) if anyone has time. A generic bot that beat the generals would mean adding hidden
information or tighter time limits.
