import { Board } from '../engine/board';

/** A board as JSON; `rounds` uses null where a unit can never get. */
export interface BoardInfo {
  id: string;
  rows: string[];
  nodes: { idx: number; id: string; kind: string; army: number; num: number; coastal: boolean }[];
  hq: number[];
  territory: number[][];
  adj: number[][];
  reach: Record<string, number[][]>;
  rounds: Record<string, (number | null)[][]>;
}

export function boardInfo(board: Board): BoardInfo {
  const classes = Object.keys(board.reach) as (keyof Board['reach'])[];
  return {
    id: board.def.id,
    rows: board.def.rows,
    nodes: board.nodes.map(({ idx, id, kind, army, num, coastal }) => ({ idx, id, kind, army, num, coastal })),
    hq: board.hq,
    territory: board.territory,
    adj: board.adj,
    reach: Object.fromEntries(classes.map((c) => [c, board.reach[c]])),
    rounds: Object.fromEntries(
      classes.map((c) => [c, board.rounds[c].map((row) => row.map((d) => (Number.isFinite(d) ? d : null)))]),
    ),
  };
}
