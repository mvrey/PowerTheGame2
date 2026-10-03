// Plays a registered bot in a match on a Power server, as a remote seat.
//
//   npm run bot -- server=http://localhost:8787 match=ab12cd34 player=0 token=... bot=greedy:2
//
// Or let it create the match: the other seats are played by server bots.
//
//   npm run bot -- server=http://localhost:8787 bot=greedy vs=kruger:2,vega:1,rookie map=ring
//
// The same thing works for a bot written in any language: see BOTS.md for the endpoints.

import { HttpGameClient, createRemoteMatch, playMatch } from '../src/api';
import { bots } from '../src/bots';
import { botSpec, parseArgs } from './args';

const args = parseArgs();
const server = args.get('server') ?? 'http://localhost:8787';
const me = botSpec(args.get('bot') ?? 'okoye');
const bot = bots.create(me.id, { level: me.level });

let matchId = args.get('match');
let player = Number(args.get('player') ?? 0);
let token = args.get('token') ?? '';

if (!matchId) {
  const rivals = (args.get('vs') ?? 'kruger,vega,tanaka').split(',').map(botSpec);
  const created = await createRemoteMatch(server, {
    map: args.get('map'),
    seats: [{ name: `${me.id} (remote)` }, ...rivals.map((r) => ({ bot: r.id, level: r.level }))],
  });
  matchId = created.id;
  player = 0;
  token = created.seats[0].token!;
  console.log(`Created match ${matchId}: ${created.seats.map((s) => s.name).join(' vs ')}`);
}

const client = new HttpGameClient(server, matchId, player, token);
const end = await playMatch(bot, client, {
  onProblem: (problem) => console.warn(`round ${problem.round}: ${problem.kind}`, problem.kind === 'crashed' ? problem.error : ''),
});
const outcome = end.winners.includes(player) ? (end.winners.length > 1 ? 'draw' : 'won') : end.players[player].alive ? 'lost' : 'eliminated';
console.log(`Match ${matchId}: ${outcome} after round ${end.round}${end.over ? ` (${end.endReason})` : ''}.`);
