import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// The layering of ARCHITECTURE.md, checked on the import statements. The platform knows no game;
// a game knows the platform's contract (platform/core) but never its Node side; only the
// composition roots (src/jam, src/viewer) know both.

const root = resolve(__dirname, '..');

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(ts|mts)$/.test(path)) out.push(path);
  }
  return out;
}

const posix = (path: string) => path.split(sep).join('/');
/** Whether a module path lies in a folder (a folder import names the folder itself). */
const within = (path: string, folder: string) => path === folder || path.startsWith(folder + '/');

/** Project-relative paths of the local modules a file imports, and the bare modules it imports. */
function imports(file: string): { local: string[]; packages: string[] } {
  const source = readFileSync(file, 'utf8');
  const local: string[] = [];
  const packages: string[] = [];
  for (const m of source.matchAll(
    /(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith('.')) local.push(posix(relative(root, resolve(file, '..', spec))));
    else packages.push(spec);
  }
  return { local, packages };
}

const sources = (dir: string) => files(join(root, dir)).map((f) => ({ file: posix(relative(root, f)), ...imports(f) }));

/** Which project folders each layer may import (besides itself). */
const ALLOWED: Record<string, string[]> = {
  'src/platform/core': [],
  'src/platform/node': ['src/platform/core'],
  'src/platform/web': ['src/platform/core'],
  'src/games/power/engine': [],
  'src/games/power/api': ['src/games/power/engine', 'src/platform/core'],
  'src/games/power/bots': ['src/games/power/api'],
  'src/games/power/module': ['src/games/power/api', 'src/games/power/bots', 'src/platform/core'],
  'src/games/power/play': ['src/games/power/api', 'src/games/power/bots', 'src/platform/web'],
  'src/games/power/viewer': [
    'src/games/power/api',
    'src/games/power/play',
    'src/games/power/module',
    'src/platform/core',
    'src/platform/web',
  ],
};

/** Layers that must run in a browser as well as in Node. */
const PORTABLE = [
  'src/platform/core',
  'src/games/power/engine',
  'src/games/power/api',
  'src/games/power/bots',
  'src/games/power/module',
];

/** Layers that must not touch the DOM or browser storage. */
const HEADLESS = [...PORTABLE, 'src/platform/node', 'src/jam'];

describe('architecture', () => {
  it.each(Object.entries(ALLOWED))('%s imports only what its layer allows', (layer, allowed) => {
    for (const { file, local } of sources(layer))
      for (const dep of local)
        expect(
          [layer, ...allowed].some((ok) => within(dep, ok)),
          `${file} imports ${dep}`,
        ).toBe(true);
  });

  it('games never reach into the platform runtime or the composition roots', () => {
    for (const { file, local } of sources('src/games'))
      for (const dep of local)
        expect(
          ['src/platform/node', 'src/jam', 'src/viewer'].some((root) => within(dep, root)),
          `${file} imports ${dep}`,
        ).toBe(false);
  });

  it('the platform knows no game', () => {
    for (const { file, local } of sources('src/platform'))
      for (const dep of local) expect(within(dep, 'src/games'), `${file} imports ${dep}`).toBe(false);
  });

  it.each(PORTABLE)('%s runs in the browser too: no Node modules', (layer) => {
    for (const { file, packages } of sources(layer))
      for (const pkg of packages) expect(pkg.startsWith('node:'), `${file} imports ${pkg}`).toBe(false);
  });

  it.each(HEADLESS)('%s does not touch the DOM or browser storage', (layer) => {
    for (const { file } of sources(layer))
      expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(/\b(document|window|localStorage)\./);
  });
});
