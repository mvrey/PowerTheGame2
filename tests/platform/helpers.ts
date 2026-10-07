import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GamePackage } from '../../src/platform/core/bots';
import { Limits } from '../../src/platform/core/protocol';
import { Replay } from '../../src/platform/core/replay';
import { playMatch } from '../../src/platform/node/match';
import { Runner, resolveBot } from '../../src/platform/node/runners';

/** A fresh folder holding `files` (path → content). */
export function folderWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'jam-test-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** Plays a match between bot specs (folders or "builtin:…") with a runner. */
export function playSpecs(
  pkg: GamePackage,
  runner: Runner,
  specs: string[],
  options: { format: string; variant: string; maxTurns: number; limits?: Partial<Limits> },
): Promise<Replay> {
  return playMatch({
    pkg,
    runner,
    bots: specs.map((spec) => resolveBot(spec, pkg)),
    setup: { format: options.format, variant: options.variant, maxTurns: options.maxTurns, seed: 11 },
    matchId: 'test',
    limits: { startupMs: 15000, turnMs: 3000, maxStderrBytes: 4096, ...options.limits },
  });
}
