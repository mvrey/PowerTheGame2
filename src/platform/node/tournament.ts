import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { GamePackage } from '../core/bots';
import { DEFAULT_LIMITS, Limits } from '../core/protocol';
import { WorldCupOverrides, defaultWorldCup, validateWorldCup, withOverrides } from '../core/tournament/config';
import { planTournament } from '../core/tournament/plan';
import { Fixture, FixtureResult, LiveStatus, TournamentPlan, TournamentRecord } from '../core/tournament/types';

export type { LiveStatus, TournamentRecord } from '../core/tournament/types';
import { PLATFORM_VERSION } from '../core/version';
import { playMatch } from './match';
import { MANIFEST_FILE } from './manifest';
import { DEFAULT_DOCKER, DockerOptions, DockerRunner, LocalRunner, ResolvedBot, Runner, resolveBot } from './runners';
import { readJsonIfExists, writeJsonAtomic } from './store';

/** A tournament as the organizer writes it (see Docs/Organizer.md). */
export interface TournamentFile {
  id: string;
  title?: string;
  game: string;
  seed: number;
  /** Bot folders, "builtin:<id>", or "folder/*" for every bot folder inside a folder. */
  bots: string[];
  format?: WorldCupOverrides;
  limits?: Partial<Limits>;
  runner?: { type: 'local' } | ({ type: 'docker' } & Partial<DockerOptions>);
  /** Matches played at the same time. */
  concurrency?: number;
}

export const FILES = {
  record: 'tournament.json',
  results: 'results.json',
  live: 'live.json',
  replays: 'replays',
} as const;

/** Reads the bot specs of a tournament file, expanding "folder/*". Paths are relative to the file. */
export function expandBotSpecs(specs: string[], baseDir: string): string[] {
  return specs.flatMap((spec) => {
    if (spec.startsWith('builtin:')) return [spec];
    const path = resolve(baseDir, spec);
    if (!spec.endsWith('/*')) return [path];
    const folder = path.slice(0, -2);
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(folder, entry.name, MANIFEST_FILE)))
      .map((entry) => join(folder, entry.name))
      .sort();
  });
}

export function makeRunner(runner: TournamentFile['runner']): Runner {
  if (!runner || runner.type === 'local') return new LocalRunner();
  const { type: _type, ...options } = runner;
  return new DockerRunner({ ...DEFAULT_DOCKER, ...options, images: { ...DEFAULT_DOCKER.images, ...options.images } });
}

export interface RunOptions {
  /** Where the tournament keeps its record, results, replays and live status. */
  outDir: string;
  /** Folder that relative bot paths start from (the tournament file's folder). */
  baseDir: string;
  log?: (message: string) => void;
}

/**
 * Plays a tournament to the end, or continues one that was interrupted: matches already played
 * are kept. Refuses to continue if the bots, their code or the configuration changed.
 */
export async function runTournament(file: TournamentFile, pkg: GamePackage, o: RunOptions): Promise<LiveStatus> {
  const log = o.log ?? (() => {});
  const config = withOverrides(defaultWorldCup(pkg), file.format);
  const problems = validateWorldCup(config, pkg.game);
  if (problems.length) throw new Error(`invalid format:\n- ${problems.join('\n- ')}`);
  const bots = expandBotSpecs(file.bots, o.baseDir).map((spec) => resolveBot(spec, pkg));
  const duplicate = bots.find((b, i) => bots.findIndex((c) => c.id === b.id) !== i);
  if (duplicate) throw new Error(`two bots share the id "${duplicate.id}" (folder names must differ)`);
  const runner = makeRunner(file.runner);
  const limits: Limits = { ...DEFAULT_LIMITS, ...file.limits };

  const record: TournamentRecord = {
    id: file.id,
    title: file.title ?? file.id,
    game: { id: pkg.game.id, version: pkg.game.version },
    platformVersion: PLATFORM_VERSION,
    seed: file.seed,
    config,
    limits,
    runner: runner.description,
    entrants: bots.map(({ id, name, version }) => ({ id, name, version })),
  };
  const recordPath = join(o.outDir, FILES.record);
  const previous = readJsonIfExists<TournamentRecord>(recordPath);
  if (previous && JSON.stringify({ ...previous, runner: '' }) !== JSON.stringify({ ...record, runner: '' }))
    throw new Error(
      `${recordPath} describes a different tournament (bots, code or settings changed): use a new output folder`,
    );
  writeJsonAtomic(recordPath, record);

  const results = readJsonIfExists<FixtureResult[]>(join(o.outDir, FILES.results)) ?? [];
  const byId = new Map(bots.map((b) => [b.id, b]));
  const running = new Set<string>();
  const publish = (plan: TournamentPlan) =>
    writeJsonAtomic(join(o.outDir, FILES.live), {
      record,
      plan,
      running: [...running],
      results,
      updatedAt: new Date().toISOString(),
    });

  log(`${record.title}: ${bots.length} bots, ${runner.description}`);
  for (;;) {
    const plan = planTournament(config, record.entrants, file.seed, results);
    publish(plan);
    if (plan.ranking) {
      log(`Champion: ${byId.get(plan.ranking[0])!.name}`);
      return { record, plan, running: [], results, updatedAt: new Date().toISOString() };
    }
    await pool(plan.pending, Math.max(1, file.concurrency ?? 1), async (fixture) => {
      running.add(fixture.id);
      publish(plan);
      const result = await playFixture(fixture, record, pkg, runner, byId, limits, o.outDir);
      running.delete(fixture.id);
      results.push(result);
      writeJsonAtomic(join(o.outDir, FILES.results), results);
      publish(planTournament(config, record.entrants, file.seed, results));
      const names = fixture.seats.map((id) => byId.get(id)!.name);
      log(`${fixture.id.padEnd(9)} ${names.map((n, seat) => `${n} #${result.placements[seat].rank}`).join('  ')}`);
    });
  }
}

async function playFixture(
  fixture: Fixture,
  record: TournamentRecord,
  pkg: GamePackage,
  runner: Runner,
  bots: Map<string, ResolvedBot>,
  limits: Limits,
  outDir: string,
): Promise<FixtureResult> {
  const replay = await playMatch({
    pkg,
    runner,
    limits,
    bots: fixture.seats.map((id) => bots.get(id)!),
    setup: fixture.setup,
    matchId: `${record.id}-${fixture.id}`,
    label: fixture.label,
  });
  const path = `${FILES.replays}/${fixture.id}.json`;
  writeJsonAtomic(join(outDir, path), replay);
  return {
    fixtureId: fixture.id,
    placements: replay.result.placements,
    replay: path,
    failures: replay.diagnostics.map((d) => d.failures),
  };
}

/** Runs `work` on every item, at most `size` at a time. */
async function pool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

export const tournamentBaseDir = (filePath: string) => dirname(resolve(filePath));
