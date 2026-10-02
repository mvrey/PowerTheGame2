// Diagnostic: AI-vs-AI games. Usage: npx vite-node tools/selfplay.ts [mode] [games] [levels]
import { newGame, playerStrength, reserveOf } from '../src/engine/game';
import { resolveRound } from '../src/engine/resolve';
import { Order } from '../src/engine/types';
import { BALANCED } from '../src/ai/evaluate';
import { makeRng, planOrders } from '../src/ai/planner';

const mode = Number(process.argv[2] ?? 4) as 2 | 3 | 4;
const games = Number(process.argv[3] ?? 5);
const levels = (process.argv[4] ?? '2222').split('').map(Number);
const verbose = process.argv[5] === 'v';
const cfg = mode === 2
  ? [{ name: 'A', kind: 'ai' as const, armies: [0, 1] }, { name: 'B', kind: 'ai' as const, armies: [2, 3] }]
  : Array.from({ length: mode }, (_, a) => ({ name: 'P' + a, kind: 'ai' as const, armies: [a] }));

for (let g = 1; g <= games; g++) {
  const s = newGame({ mode, players: cfg });
  const rng = makeRng(g);
  let ms = 0, plans = 0;
  const counts: Record<string, number> = {};
  while (!s.over && s.round <= 80) {
    const orders: Order[][] = s.players.map((p) => {
      if (!p.alive) return [];
      const t = performance.now();
      const o = planOrders(s, p.id, { level: levels[p.id] as 1 | 2 | 3, style: BALANCED, rng });
      ms += performance.now() - t; plans++;
      for (const x of o) counts[x.k] = (counts[x.k] ?? 0) + 1;
      if (!o.length) console.log(`  empty plan r${s.round} p${p.id} pieces=${s.pieces.filter((q) => p.armies.includes(q.army)).map((q) => q.type + '@' + q.loc).join(',')} power=${p.armies.map((a) => s.armies[a].power)}`);
      return o;
    });
    const ev = resolveRound(s, orders, { record: verbose, lastRound: s.round === 80 });
    if (verbose) for (const e of ev) if (e.t !== 'order' && e.t !== 'turn') { const { snap, ...rest } = e; console.log(s.round, JSON.stringify(rest)); }
  }
  console.log(`game ${g}: rounds=${s.round} reason=${s.endReason} winners=${s.winners} strength=${s.players.map((p) => playerStrength(s, p.id))} alive=${s.players.map((p) => +p.alive)} ms/plan=${(ms / plans).toFixed(1)} orders=${JSON.stringify(counts)} reserve=${s.armies.map((a) => reserveOf(s, a.id).length)}`);
}
