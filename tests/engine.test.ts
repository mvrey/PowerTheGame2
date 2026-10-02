import { describe, expect, it } from 'vitest';
import { ADJ, HQ, NODES, NODE_BY_ID as N, NUM_NODES, REACH, RESERVE, TERRITORY, canReach } from '../src/engine/board';
import { addPiece, armyStrength, newGame, reserveOf } from '../src/engine/game';
import { resolveRound } from '../src/engine/resolve';
import { applyOrder, checkOrder, cheapestMissileSpend } from '../src/engine/rules';
import { GameState, Order, PieceType } from '../src/engine/types';

const G = 0, B = 1, Y = 2, R = 3;

function game4(): GameState {
  return newGame({
    mode: 4,
    players: [0, 1, 2, 3].map((a) => ({ name: 'P' + a, kind: 'ai' as const, armies: [a] })),
  });
}
/** Empty board with the four armies alive. */
function bare(state = game4()): GameState {
  state.pieces = [];
  return state;
}
const put = (s: GameState, type: PieceType, army: number, node: string | number) =>
  addPiece(s, type, army, typeof node === 'string' ? N[node] : node);
const move = (army: number, type: PieceType, from: string | number, to: string | number): Order => ({
  k: 'move', army, type,
  from: typeof from === 'string' ? N[from] : from,
  to: typeof to === 'string' ? N[to] : to,
});
const count = (s: GameState, army: number, loc: number, type?: PieceType) =>
  s.pieces.filter((p) => p.army === army && p.loc === loc && (!type || p.type === type)).length;
/** A harmless order so the player is not penalised. */
const idle = (s: GameState, army: number) => {
  put(s, 'S', army, HQ[army]);
  return [move(army, 'S', HQ[army], TERRITORY[army][8])];
};

describe('board', () => {
  it('has 57 spaces', () => {
    expect(NUM_NODES).toBe(57);
    expect(NODES.filter((n) => n.kind === 'sector').length).toBe(36);
    expect(NODES.filter((n) => n.kind === 'sea').length).toBe(12);
    expect(NODES.filter((n) => n.kind === 'island').length).toBe(5);
  });
  it('adjacency is symmetric', () => {
    ADJ.forEach((list, a) => list.forEach((b) => expect(ADJ[b]).toContain(a)));
  });
  it('island X touches sector 0 of every territory and the inner lanes', () => {
    const ids = ADJ[N.IX].map((i) => NODES[i].id).sort();
    expect(ids).toEqual(['B0', 'G0', 'R0', 'S1', 'S2', 'S3', 'S4', 'Y0']);
  });
  it('an HQ touches sector 8 and its two sea lanes', () => {
    expect(ADJ[N.HQY].map((i) => NODES[i].id).sort()).toEqual(['S10', 'S9', 'Y8']);
    expect(ADJ[N.HQR].map((i) => NODES[i].id).sort()).toEqual(['R8', 'S11', 'S12']);
    expect(ADJ[N.HQG].map((i) => NODES[i].id).sort()).toEqual(['G8', 'S5', 'S6']);
    expect(ADJ[N.HQB].map((i) => NODES[i].id).sort()).toEqual(['B8', 'S7', 'S8']);
  });
  it('S3 reaches six sectors and two islands', () => {
    const ids = ADJ[N.S3].map((i) => NODES[i].id).sort();
    expect(ids).toEqual(['IS', 'IX', 'R0', 'R2', 'R5', 'Y0', 'Y1', 'Y3']);
  });
  it('side islands join the 3 and 5 corners', () => {
    expect(ADJ[N.IS].map((i) => NODES[i].id).sort()).toEqual(['R5', 'S10', 'S11', 'S3', 'Y3']);
    expect(ADJ[N.IW].map((i) => NODES[i].id).sort()).toEqual(['G5', 'R3', 'S12', 'S4', 'S5']);
  });
  it('sectors 4, 6, 7 and 8 are within infantry reach of the HQ', () => {
    for (const n of [4, 6, 7, 8]) expect(canReach('inf', N['Y' + n], N.HQY)).toBe(true);
    for (const n of [0, 1, 2, 3, 5]) expect(canReach('inf', N['Y' + n], N.HQY)).toBe(false);
  });
  it('fighters reach sectors 0, 3 and 5 of other territories from their HQ', () => {
    expect(canReach('air', N.HQY, N.G0)).toBe(true);
    expect(canReach('air', N.HQY, N.R5)).toBe(true);
    expect(canReach('air', N.HQY, N.B3)).toBe(true);
    expect(canReach('air', N.HQY, N.R4)).toBe(false);
  });
  it('ground units stop on islands, planes fly over them', () => {
    expect(canReach('tank', N.Y0, N.IX)).toBe(true);
    expect(canReach('tank', N.Y0, N.G0)).toBe(false);
    expect(canReach('tank', N.IX, N.G4)).toBe(true);
    expect(canReach('air', N.Y0, N.G0)).toBe(true);
  });
  it('nobody but ships enters the sea, ships never enter sector 4', () => {
    for (const cls of ['inf', 'tank', 'air'] as const)
      for (let i = 0; i < NUM_NODES; i++) for (const to of REACH[cls][i]) expect(NODES[to].kind).not.toBe('sea');
    for (let i = 0; i < NUM_NODES; i++) for (const to of REACH.naval[i]) expect(NODES[to].num).not.toBe(4);
    expect(canReach('naval', N.S12, N.IW)).toBe(true);
    expect(canReach('naval', N.S1, N.S2)).toBe(false);
  });
});

describe('orders', () => {
  it('starts with 2 of each small piece in the HQ', () => {
    const s = game4();
    for (const a of [G, B, Y, R]) {
      for (const t of ['S', 'T', 'F', 'D'] as PieceType[]) expect(count(s, a, HQ[a], t)).toBe(2);
      expect(armyStrength(s, a)).toBe(40);
    }
  });
  it('a piece moves once per round', () => {
    const s = bare();
    put(s, 'T', Y, 'Y4');
    expect(checkOrder(s, 2, move(Y, 'T', 'Y4', 'Y0'))).toBeNull();
    applyOrder(s, move(Y, 'T', 'Y4', 'Y0'));
    expect(checkOrder(s, 2, move(Y, 'T', 'Y0', 'IX'))).toBe('cantMove');
  });
  it('rejects out of range moves and foreign pieces', () => {
    const s = bare();
    put(s, 'T', Y, 'Y8');
    expect(checkOrder(s, 2, move(Y, 'T', 'Y8', 'G0'))).toBe('unreachable');
    expect(checkOrder(s, 1, move(Y, 'T', 'Y8', 'Y4'))).toBe('notYours');
    expect(checkOrder(s, 2, move(Y, 'S', 'Y8', 'Y4'))).toBe('noPiece');
  });
  it('buys, trades up in the Reserve and deploys in one round', () => {
    const s = bare();
    s.armies[Y].power = 2;
    addPiece(s, 'S', Y, RESERVE);
    addPiece(s, 'S', Y, RESERVE);
    const orders: Order[] = [
      { k: 'buy', army: Y, type: 'S' },
      { k: 'up', army: Y, type: 'S', at: RESERVE },
      move(Y, 'R', RESERVE, 'HQY'),
    ];
    for (const o of orders) {
      expect(checkOrder(s, 2, o)).toBeNull();
      applyOrder(s, o);
    }
    expect(count(s, Y, N.HQY, 'R')).toBe(1);
    expect(s.armies[Y].power).toBe(0);
    expect(reserveOf(s, Y).length).toBe(0);
  });
  it('Reserve pieces only go to the own HQ', () => {
    const s = bare();
    addPiece(s, 'F', Y, RESERVE);
    expect(checkOrder(s, 2, move(Y, 'F', RESERVE, 'Y8'))).toBe('onlyHQ');
  });
  it('pieces moved together can be traded, but the new piece cannot move', () => {
    const s = bare();
    put(s, 'F', Y, 'Y4'); put(s, 'F', Y, 'Y4'); put(s, 'F', Y, 'Y8');
    applyOrder(s, move(Y, 'F', 'Y8', 'Y4'));
    const up: Order = { k: 'up', army: Y, type: 'F', at: N.Y4 };
    expect(checkOrder(s, 2, up)).toBeNull();
    applyOrder(s, up);
    expect(count(s, Y, N.Y4, 'B')).toBe(1);
    expect(checkOrder(s, 2, move(Y, 'B', 'Y4', 'Y0'))).toBe('cantMove');
  });
  it('finds the cheapest megamissile recipe', () => {
    const s = bare();
    put(s, 'C', Y, 'Y4'); put(s, 'H', Y, 'Y4'); put(s, 'R', Y, 'Y4'); put(s, 'B', Y, 'Y4'); put(s, 'S', Y, 'Y4');
    const r = cheapestMissileSpend(s, Y, N.Y4)!;
    expect(r.total).toBe(100);
    expect(r.spend).toEqual({ C: 1, H: 1, R: 1 });
    s.pieces = [];
    put(s, 'C', Y, 'Y4'); put(s, 'B', Y, 'Y4');
    expect(cheapestMissileSpend(s, Y, N.Y4)).toBeNull();
    s.armies[Y].power = 30;
    addPiece(s, 'C', Y, RESERVE); addPiece(s, 'B', Y, RESERVE);
    const rv = cheapestMissileSpend(s, Y, RESERVE)!;
    expect(rv.total).toBe(100);
    expect(rv.power).toBe(25);
  });
});

describe('round resolution', () => {
  it('the stronger force captures the weaker one into its Reserve', () => {
    const s = bare();
    put(s, 'T', Y, 'Y4'); put(s, 'D', R, 'IS');
    const orders: Order[][] = [idle(s, G), idle(s, B), [move(Y, 'T', 'Y4', 'Y3')], [move(R, 'D', 'IS', 'Y3')]];
    const events = resolveRound(s, orders, { record: true });
    expect(count(s, R, RESERVE, 'T')).toBe(1);
    expect(count(s, R, N.Y3, 'D')).toBe(1);
    expect(events.some((e) => e.t === 'battle' && e.winner === 3 && e.value === 3)).toBe(true);
    expect(s.players[3].stats.captured).toBe(3);
  });
  it('equal forces that both moved bounce back', () => {
    const s = bare();
    put(s, 'F', Y, 'Y4'); put(s, 'F', R, 'R0');
    resolveRound(s, [idle(s, G), idle(s, B), [move(Y, 'F', 'Y4', 'IX')], [move(R, 'F', 'R0', 'IX')]]);
    expect(count(s, Y, N.Y4, 'F')).toBe(1);
    expect(count(s, R, N.R0, 'F')).toBe(1);
  });
  it('only the pieces that moved bounce', () => {
    const s = bare();
    put(s, 'F', Y, 'IX'); put(s, 'F', R, 'R0');
    put(s, 'S', Y, 'Y8');
    resolveRound(s, [idle(s, G), idle(s, B), [move(Y, 'S', 'Y8', 'Y4')], [move(R, 'F', 'R0', 'IX')]]);
    expect(count(s, Y, N.IX, 'F')).toBe(1);
    expect(count(s, R, N.R0, 'F')).toBe(1);
  });
  it('a piece bouncing home into an equal invader makes the invader withdraw', () => {
    const s = bare();
    put(s, 'F', Y, 'Y0'); put(s, 'F', R, 'R0'); put(s, 'F', G, 'G0');
    // Y and R tie on X; G moves into Y0, where the bounced Y fighter returns.
    resolveRound(s, [[move(G, 'F', 'G0', 'Y0')], idle(s, B), [move(Y, 'F', 'Y0', 'IX')], [move(R, 'F', 'R0', 'IX')]]);
    expect(count(s, Y, N.Y0, 'F')).toBe(1);
    expect(count(s, G, N.G0, 'F')).toBe(1);
    expect(count(s, R, N.R0, 'F')).toBe(1);
  });
  it('three sides: the two strongest tie and withdraw, the weakest stays', () => {
    const s = bare();
    put(s, 'F', Y, 'Y0'); put(s, 'F', R, 'R0'); put(s, 'S', G, 'G0');
    resolveRound(s, [[move(G, 'S', 'G0', 'IX')], idle(s, B), [move(Y, 'F', 'Y0', 'IX')], [move(R, 'F', 'R0', 'IX')]]);
    expect(count(s, G, N.IX, 'S')).toBe(1);
    expect(count(s, Y, N.Y0, 'F')).toBe(1);
  });
  it('three sides: the strongest beats two tied weaker ones', () => {
    const s = bare();
    put(s, 'F', Y, 'Y0'); put(s, 'F', R, 'R0'); put(s, 'D', G, 'G0');
    resolveRound(s, [[move(G, 'D', 'G0', 'IX')], idle(s, B), [move(Y, 'F', 'Y0', 'IX')], [move(R, 'F', 'R0', 'IX')]]);
    expect(count(s, G, RESERVE, 'F')).toBe(2);
  });
  it('collects one Power per enemy territory occupied, none for islands or eliminated armies', () => {
    const s = bare();
    put(s, 'F', Y, 'R5'); put(s, 'F', Y, 'R4'); put(s, 'F', Y, 'B3'); put(s, 'F', Y, 'IX'); put(s, 'F', Y, 'G0');
    s.armies[G].alive = false; s.players[0].alive = false;
    resolveRound(s, [[], idle(s, B), idle(s, Y), idle(s, R)]);
    expect(s.armies[Y].power).toBe(2);
  });
  it('captures a flag only with infantry, and takes everything', () => {
    const s = bare();
    put(s, 'B', Y, 'R8'); put(s, 'S', Y, 'R7');
    put(s, 'T', R, 'HQR'); put(s, 'D', R, 'S12'); addPiece(s, 'F', R, RESERVE);
    s.armies[R].power = 4;
    const noInf = resolveRound(s, [idle(s, G), idle(s, B), [move(Y, 'B', 'R8', 'HQR')], [move(R, 'D', 'S12', 'IW')]], { record: true });
    expect(s.armies[R].alive).toBe(true);
    expect(noInf.some((e) => e.t === 'flag')).toBe(false);
    expect(count(s, Y, RESERVE, 'T')).toBe(1);
    resolveRound(s, [idle(s, G), idle(s, B), [move(Y, 'S', 'R7', 'HQR')], [move(R, 'D', 'IW', 'S12')]]);
    expect(s.armies[R].alive).toBe(false);
    expect(s.players[3].alive).toBe(false);
    expect(s.pieces.some((p) => p.army === R)).toBe(false);
    expect(count(s, Y, RESERVE, 'D')).toBe(1);
    expect([...s.armies[Y].flags].sort()).toEqual([Y, R]);
    // 1 Power for holding red territory in round one, plus the 4 looted.
    expect(s.armies[Y].power).toBe(5);
  });
  it('a megamissile destroys everything on its target except the flag', () => {
    const s = bare();
    addPiece(s, 'M', Y, RESERVE);
    put(s, 'C', R, 'HQR'); put(s, 'S', Y, 'R8');
    const launch: Order = { k: 'launch', army: Y, from: RESERVE, target: N.HQR, targetArmy: -1 };
    s.armies[R].power = 2;
    resolveRound(s, [idle(s, G), idle(s, B), [launch, move(Y, 'S', 'R8', 'HQR')], [{ k: 'buy', army: R, type: 'S' }]]);
    expect(s.pieces.filter((p) => p.loc === N.HQR).length).toBe(0);
    expect(s.armies[R].alive).toBe(true);
    expect(s.pieces.some((p) => p.type === 'M')).toBe(false);
    expect(s.players[2].stats.missiles).toBe(1);
  });
  it('a megamissile can wipe a Reserve, Power units included', () => {
    const s = bare();
    addPiece(s, 'M', Y, RESERVE);
    addPiece(s, 'C', R, RESERVE); addPiece(s, 'F', R, RESERVE);
    s.armies[R].power = 7;
    const launch: Order = { k: 'launch', army: Y, from: RESERVE, target: RESERVE, targetArmy: R };
    resolveRound(s, [idle(s, G), idle(s, B), [launch], [move(R, 'F', RESERVE, 'HQR')]]);
    expect(reserveOf(s, R).length).toBe(0);
    expect(s.armies[R].power).toBe(0);
    expect(count(s, R, N.HQR, 'F')).toBe(1);
  });
  it('an unlaunched megamissile is worth nothing and gets captured', () => {
    const s = bare();
    put(s, 'M', Y, 'Y0'); put(s, 'S', R, 'IX');
    resolveRound(s, [idle(s, G), idle(s, B), idle(s, Y), [move(R, 'S', 'IX', 'Y0')]]);
    expect(count(s, R, RESERVE, 'M')).toBe(1);
  });
  it('a player who gives no order pays a Power, or breaks up the smallest piece', () => {
    const s = bare();
    s.armies[Y].power = 3;
    put(s, 'R', R, 'R4');
    resolveRound(s, [idle(s, G), idle(s, B), [], []]);
    expect(s.armies[Y].power).toBe(2);
    expect(count(s, R, RESERVE, 'S')).toBe(2);
    expect(s.armies[R].power).toBe(1);
    expect(count(s, R, N.R4, 'R')).toBe(0);
  });
  it('ends the game when one player is left', () => {
    const s = bare();
    for (const a of [G, B]) {
      s.armies[a].alive = false;
      s.players[a].alive = false;
    }
    put(s, 'R', Y, 'R8');
    resolveRound(s, [[], [], [move(Y, 'R', 'R8', 'HQR')], []]);
    expect(s.over).toBe(true);
    expect(s.winners).toEqual([2]);
    expect(s.endReason).toBe('flags');
  });
  it('on the time limit the strongest player wins', () => {
    const s = game4();
    s.armies[B].power = 5;
    resolveRound(s, [0, 1, 2, 3].map((a) => [move(a, 'S', HQ[a], TERRITORY[a][8])]), { lastRound: true });
    expect(s.over).toBe(true);
    expect(s.winners).toEqual([1]);
    expect(s.endReason).toBe('time');
  });
  it('rotates the referee clockwise', () => {
    const s = game4();
    expect(s.referee).toBe(0);
    resolveRound(s, [0, 1, 2, 3].map((a) => [move(a, 'S', HQ[a], TERRITORY[a][8])]));
    expect(s.referee).toBe(1);
    expect(s.round).toBe(2);
  });
});

describe('variants', () => {
  const two = () => newGame({
    mode: 2,
    players: [{ name: 'N', kind: 'ai', armies: [G, B] }, { name: 'S', kind: 'ai', armies: [Y, R] }],
  });
  const three = () => bare(newGame({
    mode: 3,
    players: [G, B, Y].map((a) => ({ name: 'P' + a, kind: 'ai' as const, armies: [a] })),
  }));

  it('two players: allied armies add up and never fight each other', () => {
    const s = bare(two());
    put(s, 'F', Y, 'Y0'); put(s, 'T', R, 'R0'); put(s, 'F', G, 'IX'); put(s, 'S', G, 'IX');
    put(s, 'S', B, 'B8');
    resolveRound(s, [[move(B, 'S', 'B8', 'B4')], [move(Y, 'F', 'Y0', 'IX'), move(R, 'T', 'R0', 'IX')]]);
    expect(count(s, Y, RESERVE)).toBe(2);
    expect(count(s, Y, N.IX, 'F')).toBe(1);
    expect(count(s, R, N.IX, 'T')).toBe(1);
  });
  it('two players: five orders per army', () => {
    const s = two();
    const six = ['S', 'S', 'T', 'T', 'F', 'F'].map((t) => move(Y, t as PieceType, HQ[Y], 'Y8'));
    const ev = resolveRound(s, [[move(G, 'S', HQ[G], 'G8')], [...six, move(R, 'S', HQ[R], 'R8')]], { record: true });
    expect(count(s, Y, N.Y8)).toBe(5);
    expect(count(s, R, N.R8)).toBe(1);
    expect(ev.filter((e) => e.t === 'order' && e.error === 'budget').length).toBe(1);
  });
  it('three players: conflicting mercenary orders cancel, matching ones merge', () => {
    let s = three();
    put(s, 'T', R, 'R4');
    resolveRound(s, [[move(R, 'T', 'R4', 'R0')], [move(R, 'T', 'R4', 'R8')], idle(s, Y)]);
    expect(count(s, R, N.R4, 'T')).toBe(1);
    s = three();
    put(s, 'T', R, 'R4');
    resolveRound(s, [[move(R, 'T', 'R4', 'R0')], [move(R, 'T', 'R4', 'R0')], idle(s, Y)]);
    expect(count(s, R, N.R0, 'T')).toBe(1);
    s = three();
    put(s, 'T', R, 'R4'); put(s, 'T', R, 'R4');
    resolveRound(s, [[move(R, 'T', 'R4', 'R0')], [move(R, 'T', 'R4', 'R8')], idle(s, Y)]);
    expect(count(s, R, N.R0, 'T')).toBe(1);
    expect(count(s, R, N.R8, 'T')).toBe(1);
  });
  it('three players: mercenary captures go to the mercenary Reserve', () => {
    const s = three();
    put(s, 'D', R, 'R5'); put(s, 'F', Y, 'Y3');
    resolveRound(s, [idle(s, G), idle(s, B), [move(Y, 'F', 'Y3', 'R5')]]);
    expect(count(s, R, RESERVE, 'F')).toBe(1);
  });
});
