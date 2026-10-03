import { describe, expect, it } from 'vitest';
import {
  GameClient, LocalGameClient, Match, Order, OrderSheet, RESERVE, checkOrders, legalOrders, playMatch, simulate,
} from '../src/api';
import { bots } from '../src/bots';
import { newMatch } from './helpers';

const buy = (army: number, type: 'S' | 'T' | 'F' | 'D' = 'S'): Order => ({ k: 'buy', army, type });

describe('Match', () => {
  it('collects orders, waits for everyone, then plays the round', () => {
    const match = newMatch(4);
    const { hq, reach } = match.board;
    expect(match.waitingFor()).toEqual([0, 1, 2, 3]);
    const to = reach.inf[hq[0]][0];
    expect(match.submit(0, [{ k: 'move', army: 0, type: 'S', from: hq[0], to }]).accepted).toBe(true);
    expect(match.waitingFor()).toEqual([1, 2, 3]);
    expect(match.ready).toBe(false);
    for (const p of [1, 2, 3]) match.submit(p, []);
    expect(match.ready).toBe(true);
    const report = match.resolveRound();
    expect(report.round).toBe(1);
    expect(report.status.round).toBe(2);
    expect(match.state.pieces.some((p) => p.army === 0 && p.loc === to)).toBe(true);
    expect(match.waitingFor()).toEqual([0, 1, 2, 3]);
  });

  it('refuses a submission with any illegal order, and stores nothing', () => {
    const match = newMatch(4);
    const result = match.submit(0, [buy(0), buy(1)]);
    expect(result).toMatchObject({ accepted: false, reason: 'illegal', problems: [{ index: 0, error: 'noPower' }, { index: 1, error: 'notYours' }] });
    expect(match.hasSubmitted(0)).toBe(false);
  });

  it('refuses malformed input without throwing', () => {
    const match = newMatch(4);
    for (const junk of [null, 42, {}, { k: 'move' }, { k: 'buy', army: 0, type: 'Z' }, { k: 'mk', army: 0, at: -1, power: 0, spend: { S: 'x' } }])
      expect(match.submit(0, [junk as unknown as Order]).problems[0].error).toBe('malformed');
    expect(match.submit(0, 'orders' as unknown as Order[]).accepted).toBe(false);
    expect(match.submit(9, []).reason).toBe('unknownPlayer');
  });

  it('a later submission replaces the earlier one', () => {
    const match = newMatch(4);
    const { hq, reach } = match.board;
    match.submit(0, [{ k: 'move', army: 0, type: 'T', from: hq[0], to: reach.tank[hq[0]][0] }]);
    match.submit(0, []);
    expect(match.resolveRound().orders[0]).toEqual([]);
  });

  it('views are private copies', () => {
    const match = newMatch(3);
    const view = match.view(1);
    expect(view.me).toBe(1);
    expect(view.armies).toEqual([1]);
    expect(view.commandable).toEqual([1, 3]);
    expect(view.maxOrders).toBe(5);
    view.state.pieces.length = 0;
    expect(match.state.pieces.length).toBe(32);
  });

  it('refuses orders once a player is out or the game is over', () => {
    const match = newMatch(2);
    while (!match.state.over) match.resolveRound({ lastRound: true });
    expect(match.submit(0, []).reason).toBe('over');
    expect(() => match.resolveRound()).toThrow();
  });

  it('restores a saved game', () => {
    const match = newMatch(4, 'ring');
    match.resolveRound();
    const copy = Match.restore(match.exportState());
    expect(copy.state.round).toBe(2);
    expect(copy.board).toBe(match.board);
  });
});

describe('OrderSheet', () => {
  it('sees the effect of earlier orders', () => {
    const match = newMatch(4);
    const state = match.exportState();
    state.armies[0].power = 4;
    const sheet = new OrderSheet(state, 0);
    const deploy: Order = { k: 'move', army: 0, type: 'S', from: RESERVE, to: match.board.hq[0] };
    expect(sheet.check(deploy)).toBe('noPiece');
    expect(sheet.add(buy(0))).toBe(true);
    expect(sheet.add(deploy)).toBe(true);
    expect(sheet.preview.armies[0].power).toBe(2);
    expect(state.armies[0].power).toBe(4);
    // Removing the purchase drops the deployment that needed it.
    expect(sheet.removeAt(0)).toBe(1);
    expect(sheet.orders).toEqual([]);
  });

  it('enforces the allowance', () => {
    const match = newMatch(4);
    const state = match.exportState();
    state.armies[0].power = 100;
    const sheet = new OrderSheet(state, 0);
    for (let i = 0; i < 5; i++) expect(sheet.add(buy(0))).toBe(true);
    expect(sheet.full).toBe(true);
    expect(sheet.check(buy(0))).toBe('budget');
    expect(sheet.max).toBe(5);
  });
});

describe('legalOrders', () => {
  it('lists only orders the sheet accepts, and the obvious ones are there', () => {
    const match = newMatch(4);
    const sheet = new OrderSheet(match.exportState(), 0);
    const legal = legalOrders(sheet);
    expect(legal.length).toBeGreaterThan(10);
    for (const o of legal) expect(sheet.check(o)).toBeNull();
    const { hq, reach } = match.board;
    for (const to of reach.air[hq[0]]) expect(legal).toContainEqual({ k: 'move', army: 0, type: 'F', from: hq[0], to });
    expect(legal.some((o) => o.k === 'buy')).toBe(false); // no Power yet
    expect(legal.every((o) => o.army === 0)).toBe(true);
  });

  it('includes the mercenaries in a 3-player game', () => {
    const sheet = new OrderSheet(newMatch(3).exportState(), 0);
    expect(legalOrders(sheet).some((o) => o.army === 3)).toBe(true);
  });

  it('offers building and launching a megamissile', () => {
    const state = newMatch(4).exportState();
    state.armies[0].power = 100;
    const sheet = new OrderSheet(state, 0);
    const mk = legalOrders(sheet).find((o) => o.k === 'mk');
    expect(mk).toBeDefined();
    sheet.add(mk!);
    expect(legalOrders(sheet).some((o) => o.k === 'launch')).toBe(true);
  });
});

describe('simulate and checkOrders', () => {
  it('plays a round on a copy', () => {
    const match = newMatch(4);
    const state = match.exportState();
    const { hq, reach } = match.board;
    const to = reach.inf[hq[0]][0];
    const result = simulate(state, [[{ k: 'move', army: 0, type: 'S', from: hq[0], to }]], { events: true });
    expect(result.state.round).toBe(2);
    expect(state.round).toBe(1);
    expect(result.events.some((e) => e.t === 'penalty')).toBe(true); // the others gave no orders
  });

  it('reports each wrong order with its position', () => {
    const state = newMatch(4).exportState();
    expect(checkOrders(state, 0, [buy(0), { k: 'nope' }])).toEqual([{ index: 0, error: 'noPower' }, { index: 1, error: 'malformed' }]);
  });
});

describe('clients', () => {
  it('bots play a full match concurrently through local clients', async () => {
    const match = newMatch(4);
    const clients: GameClient[] = match.state.players.map((p) => new LocalGameClient(match, p.id));
    const games = clients.map((c) => playMatch(bots.create('rookie', { level: 1 }), c));
    // The host: plays each round as soon as everybody has handed in orders.
    while (!match.state.over) {
      await new Promise((r) => setTimeout(r, 0));
      if (match.ready) match.resolveRound({ lastRound: match.state.round >= 15 });
    }
    const results = await Promise.all(games);
    for (const r of results) expect(r.over || !r.players[0].alive || r.round > 0).toBe(true);
    expect(match.state.over).toBe(true);
  });

  it('status(after) waits for the next round', async () => {
    const match = newMatch(2);
    const client = new LocalGameClient(match, 0);
    let seen = 0;
    const waiting = client.status(1).then((s) => (seen = s.round));
    await Promise.resolve();
    expect(seen).toBe(0);
    match.resolveRound();
    await waiting;
    expect(seen).toBe(2);
  });
});
