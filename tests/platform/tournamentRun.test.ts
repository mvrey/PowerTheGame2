import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { powerPackage } from '../../src/games/power/module';
import { Replay } from '../../src/platform/core/replay';
import { verifyReplay } from '../../src/platform/core/verify';
import { FILES, LiveStatus, TournamentFile, runTournament } from '../../src/platform/node/tournament';

const file: TournamentFile = {
  id: 'test-cup',
  game: 'power',
  seed: 5,
  bots: ['builtin:rookie', 'builtin:greedy', 'builtin:okoye:1', 'builtin:kruger:1', 'builtin:vega:1'],
  format: { duel: { variants: ['ring'], maxTurns: 12 }, playoff: { variants: ['ring'], maxTurns: 12 } },
  limits: { turnMs: 10000 },
  concurrency: 3,
};

describe('running a tournament', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'jam-cup-'));
  let status: LiveStatus;

  it('plays every match, keeps the replays and ranks everyone', async () => {
    status = await runTournament(file, powerPackage, { outDir, baseDir: '.' });
    expect(status.plan.ranking).toHaveLength(5);
    expect(status.plan.ranking![0]).not.toBe('builtin:rookie');
    expect(status.plan.pending).toEqual([]);
    const live = JSON.parse(readFileSync(join(outDir, FILES.live), 'utf8')) as LiveStatus;
    expect(live.plan.ranking).toEqual(status.plan.ranking);
    for (const result of status.results) {
      const replay = JSON.parse(readFileSync(join(outDir, result.replay), 'utf8')) as Replay;
      expect(verifyReplay(powerPackage.game, replay).ok, result.fixtureId).toBe(true);
      expect(replay.bots.map((b) => b.id)).toEqual(status.plan.fixtures.find((f) => f.id === result.fixtureId)!.seats);
    }
  }, 300000);

  it('resumes without playing anything twice', async () => {
    const again = await runTournament(file, powerPackage, { outDir, baseDir: '.' });
    expect(again.results).toHaveLength(status.results.length);
    expect(again.plan.ranking).toEqual(status.plan.ranking);
  }, 60000);

  it('refuses to continue a tournament whose bots or settings changed', async () => {
    await expect(runTournament({ ...file, seed: 6 }, powerPackage, { outDir, baseDir: '.' })).rejects.toThrow(
      /different tournament/,
    );
    await expect(
      runTournament({ ...file, bots: file.bots.slice(1) }, powerPackage, { outDir, baseDir: '.' }),
    ).rejects.toThrow(/different/);
  });

  it('refuses a broken format before playing anything', async () => {
    const broken: TournamentFile = {
      ...file,
      id: 'broken',
      format: { duel: { variants: ['atlantis'] }, points: { win: 0 } },
    };
    await expect(
      runTournament(broken, powerPackage, { outDir: mkdtempSync(join(tmpdir(), 'jam-x-')), baseDir: '.' }),
    ).rejects.toThrow(/duel.variants[\s\S]*points/);
  });
});
