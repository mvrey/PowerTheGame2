import { Bot, Match, PlayerConfig, PlayerView } from '../src/api';

/** The usual seating for a mode: one army each, or two allied armies each with 2 players. */
export function seats(mode: 2 | 3 | 4): PlayerConfig[] {
  return mode === 2
    ? [{ name: 'A', armies: [0, 1] }, { name: 'B', armies: [2, 3] }]
    : Array.from({ length: mode }, (_, a) => ({ name: 'P' + a, armies: [a] }));
}

export function newMatch(mode: 2 | 3 | 4, map?: string): Match {
  return Match.create({ map, mode, players: seats(mode) });
}

/** Whether the player has anything at all to give orders to. */
export function hasAssets(view: PlayerView): boolean {
  const s = view.state;
  return s.pieces.some((p) => view.armies.includes(p.army))
    || view.armies.some((a) => s.armies[a].power >= 2);
}

/** Wraps a bot to count the rounds in which it gave no orders although it could have. */
export function countEmpty(bot: Bot, tally: { empty: number }): Bot {
  return {
    async decide(view, ctx) {
      const orders = await bot.decide(view, ctx);
      if (!orders.length && hasAssets(view)) tally.empty++;
      return orders;
    },
  };
}
