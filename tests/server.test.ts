import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiError, BoardInfo, BotInfo, HttpGameClient, MatchStatus, Order, PlayerView, RoundReport, createRemoteMatch, playMatch,
} from '../src/api';
import { bots } from '../src/bots';
import { createApiServer } from '../src/server/http';
import { MatchService } from '../src/server/matchService';

const service = new MatchService({ registry: bots, longPollMs: 2000, botSliceMs: 5 });
const server = createApiServer({ service, registry: bots });
let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  service.close();
  await new Promise((resolve) => server.close(resolve));
});

async function get<T>(path: string): Promise<T> {
  const res = await fetch(base + path);
  expect(res.ok, path).toBe(true);
  return res.json() as Promise<T>;
}
async function post(path: string, body: unknown, token?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('HTTP server', () => {
  it('describes itself, its bots and its maps', async () => {
    const index = await get<{ endpoints: string[] }>('/api');
    expect(index.endpoints.some((e) => e.startsWith('POST /api/matches '))).toBe(true);
    const list = await get<BotInfo[]>('/api/bots');
    expect(list.map((b) => b.id)).toContain('kruger');
    const board = await get<BoardInfo>('/api/maps/classic');
    expect(board.nodes).toHaveLength(57);
    expect(board.rounds.inf[board.hq[0]][board.hq[1]]).toBeGreaterThan(0);
    expect((await fetch(base + '/api/nowhere')).status).toBe(404);
  });

  it('a remote bot plays a whole match against server bots', async () => {
    const created = await createRemoteMatch(base, {
      seats: [{ name: 'Remote' }, { bot: 'kruger', level: 1 }, { bot: 'rookie' }, { bot: 'vega', level: 1 }],
      maxRounds: 15,
      seed: 5,
    });
    expect(created.seats[0].token).toBeTruthy();
    expect(created.seats[1].token).toBeUndefined();
    const client = new HttpGameClient(base, created.id, 0, created.seats[0].token!);
    const end = await playMatch(bots.create('greedy', { level: 1 }), client, { onProblem: (p) => { throw new Error(p.kind); } });
    expect(end.over || !end.players[0].alive).toBe(true);

    const final = await new HttpGameClient(base, created.id, 0, '').status(1000);
    expect(final.over).toBe(true);
    const rounds = await get<RoundReport[]>(`/api/matches/${created.id}/rounds`);
    expect(rounds.length).toBe(final.round);
    expect(rounds.some((r) => r.orders[0].length > 0)).toBe(true);
    expect((await get<RoundReport[]>(`/api/matches/${created.id}/rounds?since=${final.round - 1}`)).length).toBe(1);
  }, 60000);

  it('two remote players play each other', async () => {
    const created = await createRemoteMatch(base, { mode: 2, seats: [{}, {}], maxRounds: 10 });
    const games = created.seats.map((s) =>
      playMatch(bots.create('rookie', { level: 1 }), new HttpGameClient(base, created.id, s.player, s.token!)));
    const results = await Promise.all(games);
    expect(results.every((r) => r.over)).toBe(true);
  }, 60000);

  it('guards the seats', async () => {
    const { id, seats } = await createRemoteMatch(base, { seats: [{}, { bot: 'rookie' }, {}] });
    expect((await post(`/api/matches/${id}/orders`, { player: 0, orders: [] })).status).toBe(403);
    expect((await post(`/api/matches/${id}/orders`, { player: 0, orders: [] }, seats[2].token)).status).toBe(403);
    expect((await post(`/api/matches/${id}/orders`, { player: 1, orders: [] }, seats[0].token)).status).toBe(403);
    expect((await post(`/api/matches/${id}/orders`, { player: 'x', orders: [] }, seats[0].token)).status).toBe(400);
    const bad = await post(`/api/matches/${id}/orders`, { player: 0, orders: [{ k: 'buy', army: 0, type: 'S' }] }, seats[0].token);
    expect(bad.status).toBe(200);
    expect(bad.body).toMatchObject({ accepted: false, reason: 'illegal', problems: [{ index: 0, error: 'noPower' }] });
    const ok = await post(`/api/matches/${id}/orders`, { player: 0, orders: [] }, seats[0].token);
    expect(ok.body.accepted).toBe(true);
    const view = await get<PlayerView>(`/api/matches/${id}/view?player=0`);
    expect(view.submitted).toBe(true);
    expect(view.commandable).toEqual([0, 3]); // 3 players: the fourth army is mercenary
  });

  it('rejects bad match requests', async () => {
    for (const body of [{}, { seats: [{}] }, { seats: [{}, {}], map: 'atlantis' }, { seats: [{}, { bot: 'nobody' }] },
      { seats: [{ armies: [0] }, { armies: [0] }] }, { mode: 2, seats: [{ armies: [0] }, { armies: [1, 2] }] }]) {
      const res = await post('/api/matches', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBeTruthy();
    }
    await expect(new HttpGameClient(base, 'nope', 0, '').status()).rejects.toBeInstanceOf(ApiError);
  });

  it('plays the round without latecomers once the order timeout expires', async () => {
    const { id } = await createRemoteMatch(base, { seats: [{}, { bot: 'rookie' }], orderTimeoutMs: 150, maxRounds: 2 });
    let status = await get<MatchStatus>(`/api/matches/${id}`);
    while (!status.over) status = await get<MatchStatus>(`/api/matches/${id}?after=${status.round}`);
    expect(status.round).toBe(2);
  });

  it('offers the rules helpers without a match', async () => {
    const { id } = await createRemoteMatch(base, { seats: [{}, {}, {}, {}] });
    const view = await get<PlayerView>(`/api/matches/${id}/view?player=0`);
    const legal = await post('/api/legal', { state: view.state, player: 0 });
    expect(legal.body.orders.length).toBeGreaterThan(10);
    const move = legal.body.orders.find((o: Order) => o.k === 'move') as Order;
    expect((await post('/api/check', { state: view.state, player: 0, orders: [move, { k: 'x' }] })).body)
      .toEqual({ problems: [{ index: 1, error: 'malformed' }] });
    const sim = await post('/api/simulate', { state: view.state, orders: [[move]] });
    expect(sim.body.state.round).toBe(2);
    expect(sim.body.events.length).toBeGreaterThan(0);
    expect((await post('/api/simulate', { state: { nonsense: true }, orders: [] })).status).toBe(400);
  });
});
