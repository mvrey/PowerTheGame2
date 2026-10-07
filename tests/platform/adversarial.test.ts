import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { powerPackage } from '../../src/games/power/module';
import { Failure, Replay } from '../../src/platform/core/replay';
import { verifyReplay } from '../../src/platform/core/verify';
import { DEFAULT_DOCKER, DockerRunner, LocalRunner, Runner, dockerAvailable } from '../../src/platform/node/runners';
import { playSpecs } from './helpers';

// Bots that misbehave on purpose (tests/fixtures/adversarial). Whatever they do, the match must
// finish, their opponent must be unaffected, and the failure must be recorded as what it is.

const python = process.env.JAM_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const hasPython = spawnSync(python, ['--version']).status === 0;
const hasDocker = dockerAvailable();
const TURNS = 4;
const LIMITS = { startupMs: 4000, turnMs: 1500, maxStderrBytes: 4096 };

async function against(runner: Runner, fixture: string): Promise<Replay> {
  const replay = await playSpecs(powerPackage, runner, [`tests/fixtures/adversarial/${fixture}`, 'builtin:rookie'], {
    format: 'duel',
    variant: 'classic',
    maxTurns: TURNS,
    limits: LIMITS,
  });
  // The opponent never notices, and the record holds up.
  expect(replay.turns.map((t) => t.failures[1])).toEqual(replay.turns.map(() => null));
  expect(verifyReplay(powerPackage.game, replay).ok).toBe(true);
  return replay;
}
const failuresOf = (replay: Replay): (Failure | null)[] => replay.turns.map((t) => t.failures[0]);

describe.skipIf(!hasPython)('misbehaving bots under the local runner', () => {
  const local = new LocalRunner();

  it('never gets ready: plays without answers', async () => {
    const replay = await against(local, 'never-ready');
    expect(replay.diagnostics[0].ready).toBe(false);
    expect(failuresOf(replay)).toEqual(Array(TURNS).fill('disconnected'));
  }, 30000);

  it('crashes at start: plays without answers, and the exit is recorded', async () => {
    const replay = await against(local, 'crash-start');
    expect(replay.diagnostics[0].ready).toBe(false);
    expect(replay.diagnostics[0].exit).toContain('exit code 3');
  }, 30000);

  it('spins forever: three timeouts, then it is stopped', async () => {
    const replay = await against(local, 'busy-loop');
    expect(failuresOf(replay)).toEqual(['timeout', 'timeout', 'timeout', 'disconnected']);
    expect(replay.diagnostics[0].exit).toMatch(/stopped|killed|signal/);
  }, 30000);

  it('answers garbage: every turn is invalid, and it keeps its seat', async () => {
    expect(failuresOf(await against(local, 'garbage'))).toEqual(Array(TURNS).fill('invalid'));
  }, 30000);

  it('prints to stdout: the protocol breaks, every turn is invalid', async () => {
    expect(failuresOf(await against(local, 'stdout-noise'))).toEqual(Array(TURNS).fill('invalid'));
  }, 30000);

  it('gives illegal orders: they are refused one by one, it is not a failure', async () => {
    const replay = await against(local, 'illegal');
    expect(failuresOf(replay)).toEqual(Array(TURNS).fill(null));
    expect(replay.turns[0].problems[0]).toEqual([
      { code: 'notYours', index: 0 },
      { code: 'malformed', index: 1 },
      { code: 'malformed', index: 2 },
    ]);
  }, 30000);

  it('writes an enormous line: disconnected before it is buffered', async () => {
    const replay = await against(local, 'huge-line');
    expect(failuresOf(replay)).toEqual(['crashed', 'disconnected', 'disconnected', 'disconnected']);
    expect(replay.diagnostics[0].exit).toContain('longer than the limit');
  }, 30000);

  it('floods its output: disconnected', async () => {
    const replay = await against(local, 'flood');
    expect(failuresOf(replay).slice(1)).toEqual(['crashed', 'disconnected', 'disconnected']);
    expect(replay.diagnostics[0].exit).toContain('flooded');
  }, 30000);

  it('crashes mid-match: disconnected, with its traceback kept', async () => {
    const replay = await against(local, 'crash-mid');
    expect(failuresOf(replay)).toEqual([null, 'crashed', 'disconnected', 'disconnected']);
    expect(replay.diagnostics[0].stderr).toContain('crash in turn 2');
  }, 30000);

  it('floods its logs: they are cut at the limit, and it plays normally', async () => {
    const replay = await against(local, 'stderr-flood');
    expect(failuresOf(replay)).toEqual(Array(TURNS).fill(null));
    expect(replay.diagnostics[0].stderr.length).toBeLessThan(LIMITS.maxStderrBytes + 100);
  }, 30000);
});

// Only meaningful inside the sandbox: on the local runner these bots would really do it.
describe.skipIf(!hasDocker)('misbehaving bots in the sandbox (needs Docker and the runtime images)', () => {
  const sandbox = new DockerRunner({
    ...DEFAULT_DOCKER,
    runtime: process.env.JAM_DOCKER_RUNTIME ?? DEFAULT_DOCKER.runtime,
  });

  it('cannot reach the network, the host files, secrets, or write outside /tmp', async () => {
    const replay = await against(sandbox, 'escape');
    expect(replay.diagnostics[0].stderr).toContain('ESCAPE-REPORT ["wrote /tmp/x"]');
  }, 120000);

  it('runs out of memory without hurting anyone else', async () => {
    const replay = await against(sandbox, 'memory-hog');
    expect(failuresOf(replay)[0]).toBe('crashed');
  }, 120000);

  it('cannot fork without limit', async () => {
    const replay = await against(sandbox, 'fork-bomb');
    expect(replay.diagnostics[0].stderr).toContain('blocked after');
  }, 120000);
});
