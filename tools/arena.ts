// Headless tournaments between registered bots.
//
//   npm run arena -- bots=greedy,kruger:3,vega,rookie games=8 map=classic rounds=80 seed=1
//
// bots     Bot ids, optionally with a level (id:1..3). 2 to 4 of them; their count sets the mode.
//          With 2 bots each plays two allied armies; with 3 the fourth army is mercenary.
// games    Games to play. Seats rotate between games so nobody keeps the same colour.
// map      Map id (default classic).  rounds  Round limit per game (default 80).
// seed     First seed (default 1).    verbose Print every round's battles and flags.

import { MAPS, Match, playerStrength, runHeadless } from '../src/api';
import { bots } from '../src/bots';
import { botSpec, parseArgs } from './args';

const args = parseArgs();
const specs = (args.get('bots') ?? 'okoye,kruger,vega,rookie').split(',').map(botSpec);
const games = Number(args.get('games') ?? 4);
const map = args.get('map') ?? 'classic';
const rounds = Number(args.get('rounds') ?? 80);
const seed = Number(args.get('seed') ?? 1);
const verbose = args.has('verbose');

if (specs.length < 2 || specs.length > 4) throw new Error('Give 2 to 4 bots');
if (!MAPS.some((m) => m.id === map)) throw new Error(`Unknown map ${map}: ${MAPS.map((m) => m.id).join(', ')}`);
for (const s of specs) bots.get(s.id);
const mode = specs.length as 2 | 3 | 4;
const label = (i: number) => `${specs[i].id}:${specs[i].level}`;

const score = specs.map(() => ({ wins: 0, draws: 0, strength: 0, ms: 0, turns: 0, problems: 0 }));
console.log(`${games} game(s) on ${map}: ${specs.map((_, i) => label(i)).join(' vs ')}`);

for (let g = 0; g < games; g++) {
  // Seat k is played by entry (k + g) % n: everybody gets every seat in turn.
  const entryAt = (seat: number) => (seat + g) % mode;
  const armies = mode === 2 ? [[0, 1], [2, 3]] : Array.from({ length: mode }, (_, a) => [a]);
  const match = Match.create({ map, mode, players: armies.map((a, seat) => ({ name: label(entryAt(seat)), armies: a })) });
  const players = armies.map((_, seat) => {
    const entry = entryAt(seat);
    const bot = bots.create(specs[entry].id, { level: specs[entry].level });
    return {
      async decide(...args: Parameters<typeof bot.decide>) {
        const started = performance.now();
        const orders = await bot.decide(...args);
        score[entry].ms += performance.now() - started;
        score[entry].turns++;
        return orders;
      },
    };
  });
  const end = await runHeadless(match, players, {
    seed: seed + g,
    maxRounds: rounds,
    onProblem: (player, problem) => {
      score[entryAt(player)].problems++;
      console.log(`  ${label(entryAt(player))} ${problem.kind} in round ${problem.round}`, problem.kind === 'crashed' ? problem.error : '');
    },
    onRound: (report) => {
      if (!verbose) return;
      for (const e of report.events)
        if (e.t === 'battle' || e.t === 'flag' || e.t === 'strike' || e.t === 'out') console.log(`  r${report.round}`, JSON.stringify(e));
    },
  });
  for (const p of match.state.players) score[entryAt(p.id)].strength += playerStrength(match.state, p.id);
  for (const w of end.winners) {
    if (end.winners.length === 1) score[entryAt(w)].wins++;
    else score[entryAt(w)].draws++;
  }
  const names = end.winners.map((w) => label(entryAt(w))).join(', ') || 'nobody';
  console.log(`game ${g + 1}: ${names} after ${end.round} rounds (${end.endReason})`);
}

console.log('\nbot           wins  draws  avg strength  ms/turn  problems');
score.forEach((s, i) => console.log(
  `${label(i).padEnd(13)} ${String(s.wins).padStart(4)}  ${String(s.draws).padStart(5)}  ${(s.strength / games).toFixed(0).padStart(12)}  ${(s.ms / Math.max(1, s.turns)).toFixed(1).padStart(7)}  ${String(s.problems).padStart(8)}`));
