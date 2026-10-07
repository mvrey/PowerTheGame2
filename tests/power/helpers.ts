import { Bot, Match, Mode, PlayerView, defaultSeating } from '../../src/games/power/api';

export function newMatch(mode: Mode, map?: string): Match {
  const players = defaultSeating(mode).map((armies, seat) => ({ name: 'P' + seat, armies }));
  return Match.create({ map, mode, players });
}

/** Whether the player has anything at all to give orders to. */
export function hasAssets(view: PlayerView): boolean {
  const s = view.state;
  return s.pieces.some((p) => view.armies.includes(p.army)) || view.armies.some((a) => s.armies[a].power >= 2);
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
