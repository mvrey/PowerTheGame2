// Phase-1 checks of a game for the jam (Docs/Design.md §2): is it balanced between seats, and does
// a generic search baseline beat hand-written strategy? Prints the numbers for Docs/Games/<game>.md.
//
//   npm run research -- [--games 12] [--turns 60] [--game power]

import { gamePackage } from '../src/games';
import { parseArgs, integerOption, option } from '../src/jam/args';
import { GamePackage } from '../src/platform/core/bots';
import { deriveSeed } from '../src/platform/core/random';
import { playMatch } from '../src/platform/node/match';
import { LocalRunner, resolveBot } from '../src/platform/node/runners';

const args = parseArgs(process.argv.slice(2).filter((a) => a !== '--'));
const pkg = gamePackage(option(args, 'game', 'power')!);
const games = integerOption(args, 'games', 12);
const turns = integerOption(args, 'turns', pkg.defaults.maxTurns);
const runner = new LocalRunner();
const duel = pkg.game.formats.find((f) => f.players === 2)!.id;

interface Tally {
  wins: number;
  draws: number;
  losses: number;
}

/** Plays `a` against `b` over the default variants, alternating seats; the tally is from a's side. */
async function series(p: GamePackage, a: string, b: string): Promise<Tally> {
  const tally: Tally = { wins: 0, draws: 0, losses: 0 };
  for (let g = 0; g < games; g++) {
    const seatOfA = g % 2;
    const specs = seatOfA === 0 ? [a, b] : [b, a];
    const variant = p.defaults.variants[Math.floor(g / 2) % p.defaults.variants.length];
    const replay = await playMatch({
      pkg: p,
      runner,
      bots: specs.map((s) => resolveBot(s, p)),
      setup: { format: duel, variant, maxTurns: turns, seed: deriveSeed(7, `${a}-${b}-${g}`) },
      matchId: `research-${g}`,
      limits: { turnMs: 60_000 },
    });
    const [mine, theirs] = [replay.result.placements[seatOfA].rank, replay.result.placements[1 - seatOfA].rank];
    if (mine < theirs) tally.wins++;
    else if (mine === theirs) tally.draws++;
    else tally.losses++;
  }
  return tally;
}

/** Seat balance: the same bot on both sides; reports how seat 0 fared. */
async function seatBalance(p: GamePackage, bot: string): Promise<Tally> {
  const tally: Tally = { wins: 0, draws: 0, losses: 0 };
  for (let g = 0; g < games; g++) {
    const variant = p.defaults.variants[g % p.defaults.variants.length];
    const replay = await playMatch({
      pkg: p,
      runner,
      bots: [resolveBot(bot, p), resolveBot(bot, p)],
      setup: { format: duel, variant, maxTurns: turns, seed: deriveSeed(11, `seat-${g}`) },
      matchId: `balance-${g}`,
      limits: { turnMs: 60_000 },
    });
    const [first, second] = replay.result.placements.map((x) => x.rank);
    if (first < second) tally.wins++;
    else if (first === second) tally.draws++;
    else tally.losses++;
  }
  return tally;
}

const show = (t: Tally) => `${t.wins} won, ${t.draws} drawn, ${t.losses} lost`;

console.log(
  `${pkg.game.id} ${pkg.game.version}: ${games} games per line, ${turns} turns, maps ${pkg.defaults.variants.join(', ')}\n`,
);
console.log('Seat balance (seat 0 with the same bot on both sides):');
for (const bot of ['builtin:okoye:2', 'builtin:montecarlo:2'])
  console.log(`  ${bot.padEnd(22)} ${show(await seatBalance(pkg, bot))}`);
console.log('\nGeneric search against hand-written strategy (from the search side):');
for (const [a, b] of [
  ['builtin:montecarlo:1', 'builtin:rookie'],
  ['builtin:montecarlo:2', 'builtin:greedy'],
  ['builtin:montecarlo:2', 'builtin:okoye:2'],
  ['builtin:montecarlo:3', 'builtin:okoye:3'],
])
  console.log(`  ${a} vs ${b}: ${show(await series(pkg, a, b))}`);
