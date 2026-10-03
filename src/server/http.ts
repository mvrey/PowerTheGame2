import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import {
  BotInfo, GameState, MAPS, Order, OrderSheet, boardInfo, checkOrders, getBoard, legalOrders, localize, simulate,
} from '../api';
import { BotRegistry } from '../bots';
import { MatchService, ServiceError } from './matchService';

// JSON over HTTP for the match service and the stateless rules helpers. Every endpoint is listed
// by GET /api and documented in BOTS.md.

type Params = Record<string, string>;
type Handler = (ctx: { params: Params; query: URLSearchParams; body: unknown; req: IncomingMessage }) => unknown | Promise<unknown>;
interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler; doc: string }

const MAX_BODY = 1 << 20;

export interface ApiServerOptions {
  service: MatchService;
  registry: BotRegistry;
}

export function createApiServer({ service, registry }: ApiServerOptions): Server {
  const routes: Route[] = [];
  const route = (method: string, path: string, doc: string, handler: Handler) => {
    const keys: string[] = [];
    const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_m, key: string) => (keys.push(key), '([^/]+)')) + '$');
    routes.push({ method, pattern, keys, handler, doc: `${method} ${path} — ${doc}` });
  };

  route('GET', '/api', 'this list', () => ({ endpoints: routes.map((r) => r.doc) }));
  route('GET', '/api/bots', 'bots that can play server-side seats', (): BotInfo[] =>
    registry.list().map((d) => ({ id: d.id, name: d.name, description: localize(d.description, 'en'), levels: d.levels !== false })));
  route('GET', '/api/maps', 'map ids', () => MAPS.map((m) => m.id));
  route('GET', '/api/maps/:id', 'a board: spaces, adjacency, one-move reach and distances', ({ params }) => {
    if (!MAPS.some((m) => m.id === params.id)) throw new ServiceError(404, `no map "${params.id}"`);
    return boardInfo(getBoard(params.id));
  });

  route('POST', '/api/matches', 'create a match (body: CreateMatchRequest); answers with the remote seats\' tokens',
    ({ body }) => service.create(body as never));
  route('GET', '/api/matches', 'all matches', () => service.list());
  route('GET', '/api/matches/:id', 'status; ?after=N waits until round N is over', ({ params, query }) =>
    service.status(params.id, query.has('after') ? int(query.get('after'), 'after') : undefined));
  route('GET', '/api/matches/:id/view', 'a player\'s view of the round being planned (?player=N)', ({ params, query }) =>
    service.view(params.id, int(query.get('player'), 'player')));
  route('POST', '/api/matches/:id/orders', 'hand in orders (body: {player, orders}; header Authorization: Bearer <token>)',
    ({ params, body, req }) => {
      const { player, orders } = (body ?? {}) as { player?: unknown; orders?: unknown };
      const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
      return service.submit(params.id, int(player, 'player'), token, orders);
    });
  route('GET', '/api/matches/:id/rounds', 'what happened in each round (?since=N for the rounds after N)', ({ params, query }) =>
    service.rounds(params.id, query.has('since') ? int(query.get('since'), 'since') : 0));

  route('POST', '/api/check', 'check orders (body: {state, player, orders}) → {problems}', ({ body }) => {
    const { state, player, orders } = body as { state: GameState; player: unknown; orders: unknown };
    return stateless(() => ({ problems: checkOrders(state, int(player, 'player'), list(orders)) }));
  });
  route('POST', '/api/legal', 'every order that could be added (body: {state, player, orders?}) → {orders}', ({ body }) => {
    const { state, player, orders } = body as { state: GameState; player: unknown; orders?: unknown };
    return stateless(() => ({ orders: legalOrders(new OrderSheet(state, int(player, 'player'), list(orders ?? []) as Order[])) }));
  });
  route('POST', '/api/simulate', 'play a round on a copy (body: {state, orders: Order[][], lastRound?}) → {state, events}', ({ body }) => {
    const { state, orders, lastRound } = body as { state: GameState; orders: unknown; lastRound?: boolean };
    return stateless(() => simulate(state, list(orders).map((o) => list(o ?? []) as Order[]), { events: true, lastRound: !!lastRound }));
  });

  return createServer(async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return send(res, 204, null);
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      const match = routes
        .map((r) => ({ r, m: r.pattern.exec(url.pathname) }))
        .filter((x) => x.m);
      if (!match.length) throw new ServiceError(404, `no endpoint ${url.pathname}; see GET /api`);
      const hit = match.find((x) => x.r.method === req.method);
      if (!hit) throw new ServiceError(405, `${req.method} not allowed on ${url.pathname}`);
      const params = Object.fromEntries(hit.r.keys.map((k, i) => [k, decodeURIComponent(hit.m![i + 1])]));
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      send(res, 200, await hit.r.handler({ params, query: url.searchParams, body, req }));
    } catch (error) {
      if (error instanceof ServiceError) send(res, error.status, { error: error.message });
      else {
        console.error(error);
        send(res, 500, { error: 'internal error' });
      }
    }
  });
}

function int(value: unknown, name: string): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n)) throw new ServiceError(400, `${name}: expected an integer`);
  return n as number;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new ServiceError(400, 'expected a list');
  return value;
}

/** Runs a rules helper on a client-supplied state, which may be nonsense. */
function stateless<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(400, 'invalid state or orders');
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new ServiceError(413, 'body too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new ServiceError(400, 'body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function cors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (body === null) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
}
