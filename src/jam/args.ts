// Command-line arguments: positional words, `--name value` or `--name=value` options (repeatable),
// and boolean `--flags` listed by the command.

export interface Args {
  positional: string[];
  options: Map<string, string[]>;
  flags: Set<string>;
}

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[], booleanFlags: readonly string[] = []): Args {
  const args: Args = { positional: [], options: new Map(), flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (!word.startsWith('--')) {
      args.positional.push(word);
      continue;
    }
    const [name, inline] = word.slice(2).split(/=(.*)/s, 2);
    if (booleanFlags.includes(name)) {
      args.flags.add(name);
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined) throw new UsageError(`--${name} needs a value`);
    args.options.set(name, [...(args.options.get(name) ?? []), value]);
  }
  return args;
}

/** The last value given for an option, or the fallback. */
export function option(args: Args, name: string, fallback?: string): string | undefined {
  return args.options.get(name)?.at(-1) ?? fallback;
}

export function integerOption(args: Args, name: string, fallback: number): number {
  const raw = option(args, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new UsageError(`--${name}: expected a whole number, got "${raw}"`);
  return n;
}
