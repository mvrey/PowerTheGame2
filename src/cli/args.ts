// Tiny command-line parsing shared by the server and the tools: arguments are written key=value.

import { BotLevel, isBotLevel } from '../api';

export function parseArgs(argv: string[] = process.argv.slice(2)): Map<string, string> {
  const out = new Map<string, string>();
  for (const arg of argv) {
    const m = /^-{0,2}([\w-]+)=(.*)$/.exec(arg);
    if (m) out.set(m[1], m[2]);
    else if (/^-{0,2}[\w-]+$/.test(arg)) out.set(arg.replace(/^-+/, ''), 'true');
  }
  return out;
}

/** "kruger:3" → { id: 'kruger', level: 3 } */
export function botSpec(spec: string): { id: string; level: BotLevel } {
  const [id, level = '2'] = spec.split(':');
  const n = Number(level);
  if (!isBotLevel(n)) throw new Error(`Bad level in "${spec}": use 1, 2 or 3`);
  return { id, level: n };
}
