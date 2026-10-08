import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  GALAXIES,
  GameState,
  HOME_KILL,
  HOME_PRODUCTION,
  NEUTRAL,
  Planet,
  TurnEvent,
  checkOrders,
  cloneState,
  createGame,
  distance,
  planetName,
  resolveTurn,
  travelTime,
} from '../../src/games/konquest/api';

/** A small hand-made galaxy: two homes and a neutral planet in a row, one turn apart. */
function galaxy(overrides: Partial<GameState> = {}, planets: Partial<Planet>[] = []): GameState {
  const base = createGame({ players: 2, seed: 1, width: 10, height: 1, neutrals: 0 });
  const make = (p: Partial<Planet>, id: number): Planet => ({
    id,
    name: planetName(id),
    x: id,
    y: 0,
    owner: NEUTRAL,
    ships: 0,
    production: 5,
    baseProduction: 5,
    kill: 0.5,
    home: NEUTRAL,
    justConquered: false,
    ...p,
  });
  return {
    ...base,
    planets: (planets.length
      ? planets
      : [
          { owner: 0, ships: 10, production: 10, baseProduction: 10, kill: 0.4, home: 0 },
          { owner: 1, ships: 10, production: 10, baseProduction: 10, kill: 0.4, home: 1 },
          { ships: 1 },
        ]
    ).map(make),
    ...overrides,
  };
}

const play = (state: GameState, orders: Parameters<typeof resolveTurn>[1], lastTurn = false): TurnEvent[] =>
  resolveTurn(state, orders, { lastTurn });

describe('KDE rules', () => {
  it('measures distance as half the grid line, and travel in whole turns', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(2.5);
    expect(travelTime({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(3);
    expect(travelTime({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1);
  });

  it('names planets A … Z, AA …', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(planetName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });

  it('starts homes with KDE stats and a turn of production; neutrals with their first ship', () => {
    const game = createGame({ players: 4, seed: 3, galaxy: 'standard' });
    const homes = game.planets.filter((p) => p.home !== NEUTRAL);
    expect(homes.map((p) => p.owner)).toEqual([0, 1, 2, 3]);
    expect(homes.every((p) => p.production === HOME_PRODUCTION && p.kill === HOME_KILL && p.ships === 10)).toBe(true);
    const neutrals = game.planets.filter((p) => p.owner === NEUTRAL);
    expect(neutrals.length).toBeGreaterThan(0);
    for (const p of neutrals) {
      expect(p.ships).toBe(DEFAULT_RULES.neutralProduction);
      expect(p.kill).toBeGreaterThanOrEqual(0.3);
      expect(p.kill).toBeLessThan(0.9);
      expect(p.production).toBeGreaterThanOrEqual(5);
      expect(p.production).toBeLessThanOrEqual(14);
    }
    expect(new Set(game.planets.map((p) => `${p.x},${p.y}`)).size).toBe(game.planets.length);
  });

  it('checks orders in sequence against the ships left, keeping the legal ones', () => {
    const state = galaxy();
    const { orders, problems } = checkOrders(state, 0, [
      { from: 0, to: 2, ships: 6, note: 'dropped' },
      { from: 0, to: 1, ships: 5 },
      { from: 1, to: 0, ships: 1 },
      { from: 0, to: 0, ships: 1 },
      { from: 0, to: 9, ships: 1 },
      { from: 0, to: 2, ships: 0 },
      { from: 0, to: 2, ships: 1.5 },
      'nonsense',
      { from: 0, to: 2, ships: 4 },
    ]);
    expect(orders).toEqual([
      { from: 0, to: 2, ships: 6 },
      { from: 0, to: 2, ships: 4 },
    ]);
    expect(problems.map((p) => p.error)).toEqual([
      'notEnough',
      'notYours',
      'samePlanet',
      'noPlanet',
      'badShips',
      'malformed',
      'malformed',
    ]);
  });

  it('flies fleets for their travel time, then they reinforce their own planets', () => {
    const state = galaxy();
    state.planets[2].x = 4;
    // From x=0 to x=4: distance 2, so it lands at the end of the second turn.
    const first = play(state, [[{ from: 0, to: 2, ships: 3 }], []]);
    expect(first[0]).toMatchObject({ kind: 'launch', fleet: { from: 0, to: 2, ships: 3, launched: 1, arrival: 2 } });
    expect(state.planets[0].ships).toBe(17);
    expect(state.fleets).toHaveLength(1);
    state.planets[2].owner = 0;
    state.planets[2].ships = 0;
    const second = play(state, [[], []]);
    expect(second.find((e) => e.kind === 'reinforce')).toMatchObject({ planet: 2, ships: 3 });
    expect(state.fleets).toEqual([]);
    // 3 ships arrived, then the planet produced its 5.
    expect(state.planets[2].ships).toBe(8);
  });

  it('fights out a battle with the dice until one side is gone, and the winner keeps the planet', () => {
    for (let dice = 1; dice < 40; dice++) {
      const state = galaxy({ dice });
      state.planets[2].ships = 4;
      const events = play(state, [[{ from: 0, to: 2, ships: 9 }], []]);
      const battle = events.find((e) => e.kind === 'battle')!;
      expect(battle).toMatchObject({ planet: 2, attacker: 0, defender: NEUTRAL, attackers: 9, defenders: 4 });
      if (battle.kind !== 'battle') throw new Error();
      if (battle.conquered) {
        expect(battle.defendersLeft).toBe(0);
        expect(battle.attackersLeft).toBeGreaterThan(0);
        expect(state.planets[2].owner).toBe(0);
        // Conquered, then produced at its owner's rate (KDE's production after conquest).
        expect(state.planets[2].ships).toBe(battle.attackersLeft + 5);
        expect(state.players[0].stats.planetsConquered).toBe(1);
      } else {
        expect(battle.attackersLeft).toBe(0);
        expect(state.planets[2].owner).toBe(NEUTRAL);
        // Held, then built its one neutral ship.
        expect(state.planets[2].ships).toBe(battle.defendersLeft + 1);
      }
    }
  });

  it('is deterministic: the same dice give the same battles', () => {
    const a = galaxy({ dice: 77 });
    const b = galaxy({ dice: 77 });
    a.planets[2].ships = 6;
    b.planets[2].ships = 6;
    const orders = [[{ from: 0, to: 2, ships: 8 }], []];
    expect(play(a, orders)).toEqual(play(b, orders));
    expect(a).toEqual(b);
  });

  it('a planet with no ships falls to any fleet that survives the first exchange', () => {
    const state = galaxy({ dice: 5 });
    state.planets[2].ships = 0;
    state.planets[2].kill = 0.5;
    play(state, [[{ from: 0, to: 2, ships: 2 }], []]);
    expect(state.planets[2].owner).toBe(0);
  });

  it('lands fleets seat by seat, each player in launch order', () => {
    const state = galaxy({ dice: 9 });
    state.planets[2].owner = 0;
    state.planets[2].ships = 0;
    // Both fleets fly 1 turn: player 1 attacks, player 0 reinforces. Player 0's fleet lands first.
    state.planets[0].x = 3;
    state.planets[1].x = 5;
    state.planets[2].x = 4;
    const events = play(state, [[{ from: 0, to: 2, ships: 10 }], [{ from: 1, to: 2, ships: 2 }]]);
    const landings = events.filter((e) => e.kind === 'reinforce' || e.kind === 'battle').map((e) => e.kind);
    expect(landings).toEqual(['reinforce', 'battle']);
  });

  it('honours the production options: cumulative production and none in the turn of conquest', () => {
    const cumulative = galaxy({ rules: { ...DEFAULT_RULES, cumulativeProduction: true } });
    play(cumulative, [[], []]);
    expect(cumulative.planets[0].production).toBe(11);
    expect(cumulative.planets[0].ships).toBe(20);

    const strict = galaxy({ rules: { ...DEFAULT_RULES, productionAfterConquest: false }, dice: 3 });
    strict.planets[2].ships = 0;
    strict.planets[2].kill = 0;
    const events = play(strict, [[{ from: 0, to: 2, ships: 5 }], []]);
    const battle = events.find((e) => e.kind === 'battle');
    expect(battle).toMatchObject({ conquered: true });
    expect(strict.planets[2].ships).toBe(5);
  });

  it('puts out a player with no planet and no fleet, and the last one standing wins', () => {
    const state = galaxy({ dice: 2 });
    state.planets[1].ships = 0;
    state.planets[1].kill = 0;
    state.planets[0].x = 1;
    state.planets[1].x = 2;
    const events = play(state, [[{ from: 0, to: 1, ships: 10 }], []]);
    expect(events.filter((e) => e.kind === 'out' || e.kind === 'end')).toEqual([
      { kind: 'out', player: 1 },
      { kind: 'end', winner: 0, reason: 'conquest' },
    ]);
    expect(state.over).toBe(true);
    expect(state.winner).toBe(0);
  });

  it('keeps a player in while a fleet of theirs still flies', () => {
    const state = galaxy({ dice: 4 });
    state.planets[1].x = 9;
    // Player 1 sends everything far away; its home falls the same turn.
    state.planets[0].x = 8;
    state.planets[1].ships = 10;
    play(state, [[], [{ from: 1, to: 2, ships: 10 }]]);
    state.planets[1].ships = 0;
    state.planets[1].kill = 0;
    play(state, [[{ from: 0, to: 1, ships: 15 }], []]);
    expect(state.planets[1].owner).toBe(0);
    expect(state.players[1].alive).toBe(true);
  });

  it('ends at the turn limit with nobody declared winner', () => {
    const state = galaxy();
    expect(play(state, [[], []], true).at(-1)).toEqual({ kind: 'end', winner: null, reason: 'turn-limit' });
  });

  it('does not change a state it was not asked to', () => {
    const state = galaxy();
    const copy = cloneState(state);
    play(copy, [[{ from: 0, to: 2, ships: 3 }], []]);
    expect(state.planets[0].ships).toBe(10);
  });
});

describe('galaxies', () => {
  const homesOf = (g: GameState) => g.planets.filter((p) => p.home !== NEUTRAL);

  it.each(GALAXIES.flatMap((def) => [2, 4, 6].map((n) => [def.id, n] as const)))(
    '%s for %i players is reproducible from the seed and fits the grid',
    (id, players) => {
      const a = createGame({ players, seed: 42, galaxy: id });
      expect(createGame({ players, seed: 42, galaxy: id })).toEqual(a);
      expect(createGame({ players, seed: 43, galaxy: id })).not.toEqual(a);
      expect(homesOf(a)).toHaveLength(players);
      for (const p of a.planets) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(a.width);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThan(a.height);
      }
    },
  );

  it('mirrors a duel: each home sees the same galaxy', () => {
    for (let seed = 0; seed < 10; seed++) {
      const g = createGame({ players: 2, seed, galaxy: 'standard' });
      const mirror = (p: Planet) => `${g.width - 1 - p.x},${g.height - 1 - p.y}`;
      const at = new Map(g.planets.map((p) => [`${p.x},${p.y}`, p]));
      for (const p of g.planets) {
        const twin = at.get(mirror(p))!;
        expect(twin.production).toBe(p.production);
        expect(twin.kill).toBe(p.kill);
        expect(twin.owner).toBe(p.owner === NEUTRAL ? NEUTRAL : 1 - p.owner);
      }
    }
  });

  it('rotates a four-player galaxy on a square grid', () => {
    const g = createGame({ players: 4, seed: 8, galaxy: 'large' });
    const [a, b] = homesOf(g);
    expect({ x: b.x, y: b.y }).toEqual({ x: g.width - 1 - a.y, y: a.x });
  });

  it('keeps homes apart, and spreads six players fairly enough', () => {
    for (let seed = 0; seed < 5; seed++) {
      const g = createGame({ players: 6, seed, galaxy: 'standard' });
      const homes = homesOf(g);
      const nearest = homes.map((h) => Math.min(...homes.filter((o) => o !== h).map((o) => distance(h, o))));
      expect(Math.min(...nearest)).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('takes custom grids and rules, as the browser game asks', () => {
    const g = createGame({
      players: 3,
      seed: 1,
      width: 7,
      height: 5,
      neutrals: 6,
      rules: { cumulativeProduction: true, neutralProduction: 3 },
    });
    expect([g.width, g.height, g.planets.length]).toEqual([7, 5, 9]);
    expect(g.rules).toEqual({ cumulativeProduction: true, productionAfterConquest: true, neutralProduction: 3 });
    expect(() => createGame({ players: 1, seed: 1 })).toThrow();
    expect(() => createGame({ players: 2, seed: 1, galaxy: 'nowhere' })).toThrow();
  });
});
