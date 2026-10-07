import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { powerPackage } from '../../src/games/power/module';
import { verifyReplay } from '../../src/platform/core/verify';
import { CappedText, LineSplitter } from '../../src/platform/node/lines';
import { ManifestError, contentHash, readManifest } from '../../src/platform/node/manifest';
import { DEFAULT_DOCKER, LocalRunner, containerName, dockerRunArgs } from '../../src/platform/node/runners';
import { folderWith, playSpecs } from './helpers';

const python = process.env.JAM_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const hasPython = spawnSync(python, ['--version']).status === 0;

describe('bot manifests', () => {
  const manifest = (fields: object, files: Record<string, string> = { 'main.py': '' }) =>
    folderWith({ 'bot.json': JSON.stringify(fields), ...files });

  it('accepts a well-formed bot', () => {
    expect(readManifest(manifest({ name: 'Alice 2', language: 'python', entry: 'main.py' }))).toEqual({
      name: 'Alice 2',
      language: 'python',
      entry: 'main.py',
      author: undefined,
    });
  });

  it.each([
    [{ name: '', language: 'python', entry: 'main.py' }, /name/],
    [{ name: '<script>', language: 'python', entry: 'main.py' }, /name/],
    [{ name: 'x'.repeat(33), language: 'python', entry: 'main.py' }, /name/],
    [{ name: 'Bob', language: 'cobol', entry: 'main.py' }, /language/],
    [{ name: 'Bob', language: 'python', entry: '../main.py' }, /entry/],
    [{ name: 'Bob', language: 'python', entry: '/etc/passwd' }, /entry/],
    [{ name: 'Bob', language: 'python', entry: 'C:/x.py' }, /entry/],
    [{ name: 'Bob', language: 'python', entry: 'other.py' }, /does not exist/],
    [{ name: 'Bob', language: 'javascript', entry: 'main.py' }, /\.mjs/],
  ])('refuses %j', (fields, message) => {
    expect(() => readManifest(manifest(fields))).toThrow(message);
  });

  it('refuses a missing or broken manifest', () => {
    expect(() => readManifest(folderWith({ 'main.py': '' }))).toThrow(ManifestError);
    expect(() => readManifest(folderWith({ 'bot.json': '{nope' }))).toThrow(ManifestError);
  });

  it('fingerprints the content of a bot folder', () => {
    const a = folderWith({ 'main.py': 'print(1)' });
    const b = folderWith({ 'main.py': 'print(2)' });
    expect(contentHash(a)).toBe(contentHash(folderWith({ 'main.py': 'print(1)' })));
    expect(contentHash(a)).not.toBe(contentHash(b));
  });
});

describe('the sandbox profile', () => {
  const bot = { dir: '/submissions/alice', manifest: { name: 'Alice', language: 'python' as const, entry: 'main.py' } };
  const args = dockerRunArgs(DEFAULT_DOCKER, bot, 'jam-x');

  it('isolates the bot: no network, read-only, unprivileged, limited', () => {
    const joined = args.join(' ');
    for (const flag of [
      '--network none',
      '--read-only',
      '--user 65534:65534',
      '--cap-drop ALL',
      '--security-opt no-new-privileges',
      '--memory 256m',
      '--memory-swap 256m',
      '--pids-limit 64',
      '--runtime runsc',
      '--rm',
      'target=/bot,readonly',
    ])
      expect(joined).toContain(flag);
    expect(args.slice(-7)).toEqual(['jam-runtime-python:3.12', 'python3', '-u', '-B', '-E', '-s', 'main.py']);
  });

  it('runs without gVisor when told to', () => {
    expect(dockerRunArgs({ ...DEFAULT_DOCKER, runtime: null }, bot, 'jam-x')).not.toContain('--runtime');
  });

  it('names containers safely whatever the match id', () => {
    expect(containerName('g/A; rm -rf', 1)).toMatch(/^jam-[a-zA-Z0-9_.-]+-s1-[0-9a-f]{6}$/);
  });
});

describe('line framing', () => {
  it('splits lines across chunks and refuses an oversized one', () => {
    const lines = new LineSplitter(10);
    expect(lines.push(Buffer.from('{"a":1}\n{"b'))).toEqual(['{"a":1}']);
    expect(lines.push(Buffer.from('":2}\r\n'))).toEqual(['{"b":2}']);
    expect(lines.push(Buffer.from('x'.repeat(11)))).toBe('overflow');
  });

  it('keeps the start of stderr and says how much was dropped', () => {
    const text = new CappedText(5);
    text.push(Buffer.from('abc'));
    text.push(Buffer.from('defgh'));
    expect(text.toString()).toBe('abcde\n[… 3 more bytes not kept]');
  });
});

describe('the starter templates', () => {
  it.each(Object.entries(powerPackage.templates))('%s template ships the current SDK files', (_language, template) => {
    for (const file of template!.sdk)
      expect(readFileSync(`${template!.dir}/${basename(file)}`, 'utf8'), file).toBe(readFileSync(file, 'utf8'));
  });

  it.skipIf(!hasPython)(
    'the Python starter plays a whole match over stdio',
    async () => {
      const replay = await playSpecs(powerPackage, new LocalRunner(), ['templates/power/python', 'builtin:rookie'], {
        format: 'duel',
        variant: 'classic',
        maxTurns: 6,
      });
      expect(replay.diagnostics[0].ready).toBe(true);
      expect(replay.turns.map((t) => t.failures[0])).toEqual(replay.turns.map(() => null));
      expect(replay.turns.some((t) => (t.responses[0] as { orders: unknown[] }).orders.length > 0)).toBe(true);
      expect(replay.turns.flatMap((t) => t.problems[0]).filter((p) => p.code === 'budget')).toEqual([]);
      expect(verifyReplay(powerPackage.game, replay).ok).toBe(true);
    },
    60000,
  );

  it('the JavaScript starter plays a whole match over stdio', async () => {
    const replay = await playSpecs(powerPackage, new LocalRunner(), ['builtin:rookie', 'templates/power/javascript'], {
      format: 'duel',
      variant: 'ring',
      maxTurns: 6,
    });
    expect(replay.diagnostics[1].ready).toBe(true);
    expect(replay.turns.map((t) => t.failures[1])).toEqual(replay.turns.map(() => null));
    expect(replay.turns.flatMap((t) => t.problems[1]).filter((p) => p.code === 'budget')).toEqual([]);
    expect(verifyReplay(powerPackage.game, replay).ok).toBe(true);
  }, 60000);
});
