import { Order } from '../engine/types';
import { GameClient } from './client';
import { MatchStatus, SubmitResult } from './match';
import { CreateMatchRequest, CreateMatchResponse } from './protocol';
import { PlayerView } from './view';

/** Error answered by the server. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiError(response.status, body?.error ?? response.statusText);
  return body as T;
}

/** Creates a match on a server (see CreateMatchRequest). */
export function createRemoteMatch(server: string, request: CreateMatchRequest): Promise<CreateMatchResponse> {
  return call(`${trim(server)}/api/matches`, { method: 'POST', body: JSON.stringify(request) });
}

const trim = (url: string) => url.replace(/\/+$/, '');

/** A seat at a match hosted by the HTTP server. */
export class HttpGameClient implements GameClient {
  private readonly base: string;

  /**
   * @param server Server address, e.g. http://localhost:8787
   * @param matchId Id returned when the match was created.
   * @param player The seat.
   * @param token The seat's token, returned when the match was created.
   */
  constructor(server: string, matchId: string, readonly player: number, private readonly token: string) {
    this.base = `${trim(server)}/api/matches/${encodeURIComponent(matchId)}`;
  }

  status(afterRound?: number): Promise<MatchStatus> {
    return call(afterRound === undefined ? this.base : `${this.base}?after=${afterRound}`);
  }

  view(): Promise<PlayerView> {
    return call(`${this.base}/view?player=${this.player}`);
  }

  submit(orders: readonly Order[]): Promise<SubmitResult> {
    return call(`${this.base}/orders`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ player: this.player, orders }),
    });
  }
}
