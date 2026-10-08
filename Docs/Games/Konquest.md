# Edition 2: Konquest

Konquest is KDE's game of galactic conquest. Planets build ships every turn, and fleets take
turns to fly between planets. Battles are fought with dice, at each planet's kill percentage.
Everyone gives orders at the same time. Nothing is hidden except the orders being written and
the dice. The rules here are KDE's (`konquest/src`), rewritten as pure functions: luck evens out
over a game, and planning wins it.

- Game id `konquest`, version `1.0.0` (sent in `hello.game`, recorded in every replay).
- Formats: `duel` (2 seats), `ffa4` (4 seats), `ffa6` (6 seats).
- Galaxies (`hello.match.variant`): `small` (10 × 10), `standard` (14 × 14), `large` (18 × 18) and
  `kde` (KDE's defaults: 10 × 10, three neutral planets, all at random).
- The rules as code: `src/games/konquest/engine`. You can play the game yourself:
  `dist/konquest.html` (after `npm run build`) or `npm run dev:konquest`.

## 1. Rules in one page

**The galaxy** is a grid of sectors, with at most one planet per sector. Each player starts on a
home planet. The other planets are neutral.

| Planet | Production | Kill percentage | Starts with |
|---|---|---|---|
| Home | 10 | 0.400 | 10 ships |
| Neutral | 5 to 14 (random) | 0.30 to 0.90 (random) | 1 ship |

A neutral planet adds `rules.neutralProduction` ships each turn (1). Once someone holds it, it
builds its own production for them. Planets keep their production and kill percentage when they
change hands.

**Distance** is KDE's: half the straight line between the sectors' grid positions,
`hypot(dx, dy) / 2`. A fleet takes `ceil(distance)` turns (at least 1). It lands at the end of
its last turn: sent in turn 5 with 2 turns to fly, it lands at the end of turn 6. Fleets cannot
be recalled or redirected.

**A turn** (one turn of the protocol):
1. **Orders**, secretly and all at once. Each order sends `ships` ships from one of your planets
   to any other planet. Orders are checked in the order you list them, against what each planet
   has left after the orders before it.
2. **Launch.** The fleets leave their planets.
3. **Landings**, player by player in seat order, and each player's fleets in launch order. This
   is KDE's order. The tournament swaps seats in duels and rotates them in free-for-alls.
   - Landing on a planet of its owner, a fleet joins its defence.
   - Landing anywhere else, it attacks. **Battle:** each round, both sides roll, and the
     defenders shoot first. A defender roll under the planet's kill percentage destroys an attacker.
     Then, if attackers are left, an attacker roll under the kill percentage *of the planet the
     fleet came from* destroys a defender. This goes on until one side has no ships. If the
     attackers win, the planet is theirs, with the ships that survived. A planet with no
     defenders falls to any fleet that survives the first defender roll.
4. **Production:** every planet builds its ships, including a planet just conquered.
5. **Out:** a player with no planet and no fleet in flight is eliminated.

**End.** The last player standing wins (`conquest`). If everyone is gone at once, it is
`mutual-destruction`. At the turn limit (`maxTurns`, 100 by default), it is `turn-limit`.

**Chance.** The dice come from the match seed, which only the referee knows. Your `hello.match.seed`
is a different seed, derived for your seat (Docs/Protocol.md), so you cannot replay the
battles. Estimate them: with kill percentages `a` (yours) and `d` (theirs), each round costs the
attackers `d` ships and the defenders `a` ships on average.

KDE's options, for the record (the tournament plays KDE's defaults, which `hello.info.rules`
repeats): `cumulativeProduction` off (production would grow by one each turn),
`productionAfterConquest` on, `neutralProduction` 1. KDE's display options (blind map, hidden
neutral ships and stats) do not exist for bots: **you see every planet and every fleet**.

## 2. What your bot receives

### `hello.info`
```jsonc
{
  "you": 0,
  "players": 2,
  "width": 14, "height": 14,                    // the grid, in sectors
  "homes": [0, 1],                              // homes[seat] = the planet that seat started on
  "rules": { "cumulativeProduction": false, "productionAfterConquest": true, "neutralProduction": 1 },
  "constants": { "homeProduction": 10, "homeKill": 0.4,
                 "neutralKill": [0.3, 0.9], "neutralProduction": [5, 14] },
  "maxTurns": 100
}
```
Seats are anonymous ("Player 1", "Player 2"). In a duel the galaxy is mirrored, so both homes see
the same galaxy. With four players it is rotated. With six, it is the most even of many random
layouts.

### `turn.observation`
```jsonc
{
  "turn": 3, "maxTurns": 100, "you": 0,
  "state": {                                    // the whole game, except the dice
    "turn": 3, "width": 14, "height": 14,
    "planets": [
      { "id": 0, "name": "A", "x": 2, "y": 11, "owner": 0, "ships": 23, "production": 10,
        "baseProduction": 10, "kill": 0.4, "home": 0, "justConquered": false },
      { "id": 2, "name": "C", "x": 6, "y": 4, "owner": -1, "ships": 3, ... }   // owner -1: neutral
    ],
    "fleets": [                                 // every fleet in flight, everyone's
      { "id": 4, "owner": 1, "from": 1, "to": 2, "ships": 7, "launched": 2, "arrival": 4 }
    ],
    "players": [{ "id": 0, "alive": true, "stats": { "shipsBuilt": 20, ... } }, ...],
    "rules": { ... }, "over": false, "winner": null, "endReason": null
  },
  "previous": {                                 // null in turn 1
    "turn": 2,
    "orders": [[{ "from": 0, "to": 2, "ships": 7 }], [...]],   // what everyone sent
    "events": [ /* launch, reinforce, battle, production, out, end */ ],
    "problems": [{ "code": "notEnough", "index": 1 }]          // what was refused in YOUR orders
  }
}
```
A `battle` event gives the planet, the attacker, the defender (-1 for neutral), the ships on each
side before and after, and whether the planet `conquered`.

## 3. What your bot answers

```json
{ "orders": [
  { "from": 0, "to": 2, "ships": 7 },
  { "from": 0, "to": 5, "ships": 12 },
  { "from": 3, "to": 0, "ships": 4 }
] }
```
- `from` must be your planet, `to` any other planet, and `ships` a whole number from 1 up to what
  is left on `from` after your earlier orders.
- Orders are checked one by one, in order. **Illegal ones are dropped and the rest are kept.**
  The next observation's `previous.problems` says which and why. At most 200 orders are read.

Refusal codes: `malformed`, `noPlanet`, `notYours`, `samePlanet`, `badShips` (fewer than one),
`notEnough` (more than is left there), `tooMany`.

## 4. How a match is ranked
The winner ranks 1st. The others are ranked by how long they lasted: a player still in at the
turn limit beats anyone eliminated, and a later elimination beats an earlier one. Ties are broken
by planets held, then by ships. The `score` of a placement is the player's ships at the end, on
planets and in flight. The tournament's material tiebreak uses it.

## 5. Starter kits and helpers
`npm run jam -- new python mybot --game konquest` (or `javascript`) creates a working bot to
start from. Its folder holds `jam.py`/`jam.mjs` (the protocol) and `konquest.py`/`konquest.mjs`
(distance, travel time, planet and fleet queries, `send(from, to, ships)`). The starter sends just
enough ships at the planet that is cheapest to take per turn of flight.

## 6. Built-in bots
Reference opponents, written in TypeScript against Konquest's API (`src/games/konquest/bots`), run
inside the referee (they are trusted). Refer to them as `builtin:<id>`.

| Id | What it is |
|---|---|
| `kde:1`, `kde:2`, `kde:3` | KDE's default AI, ported: Weak, Offensive, Defensive. From each planet with enough ships, it sends 70% to the closest planet it outnumbers. |
| `becai` | KDE's Becai AI, ported line by line: a defence sized to the game situation, attacks on the best-scored targets, support for weak planets. The strongest built-in. |
| `greedy` | Baseline: the most production per ship sent, with no look at the rivals. |
| `rookie` | Random fleets. The sparring partner of `jam check`. |
| `passive` | KDE's example AI: never sends a fleet. |
| `montecarlo` (`:1`–`:3`) | The generic baseline: random plans scored by random playouts, with no strategy (see below). |

To add one, drop a `*.bot.ts` file in `src/games/konquest/bots/`. It is discovered automatically
(see `src/games/konquest/bots/examples/random.bot.ts`).

## 7. Is the game deep enough? (Phase-1 checks)
`npm run research -- --game konquest` runs the checks that Design.md §2 asks for.

Results (12 games per line, 100 turns, galaxies standard/small/large, seats alternated):

| Check | Result |
|---|---|
| Seat balance, Becai against itself | seat 0: 3 won, 9 lost |
| Seat balance, Monte Carlo (level 2) against itself | seat 0: 7 won, 5 lost |
| Monte Carlo 1 vs Rookie (random) | 12 won |
| Monte Carlo 2 vs Greedy (production per ship) | 3 won, 9 lost |
| Monte Carlo 2 vs KDE Default (Offensive) | 2 won, 10 lost |
| Monte Carlo 3 vs Becai | 0 won, 12 lost |

(2026-10-08, game 1.0.0. No draws.)

What this says:
- **No seat advantage shows.** Becai's 3–9 looked suspicious, since KDE lands fleets in seat
  order. A larger check settled it: 180 headless Becai self-play duels (60 per galaxy) gave seat 0
  73 wins and seat 1 86, with 21 games reaching the turn limit (p ≈ 0.34, within chance). Duels
  are mirrored, and the official format swaps seats anyway.
- **A generic search does not take over.** Flat Monte Carlo beats random play, but loses to every
  hand-written strategy, even KDE's simple default AI, and all 12 games to Becai. Fleets that fly
  for several turns, dice, and wide choices (any number of ships to any planet) make blind
  sampling ineffective. Strategy wins, which is what the jam should reward.
- **Large galaxies are slow:** in that balance check, 17 of 60 Becai duels on `large` reached 100
  turns. Give `large` 150 turns or more if a tournament uses it.

Limits: 12 games per line is a smoke test, not proof. Before launch, run
`npm run research -- --game konquest --games 60`.
