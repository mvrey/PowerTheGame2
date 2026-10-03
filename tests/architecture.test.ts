import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// The layering of ARCHITECTURE.md, checked on the import statements:
//   engine  <-  api  <-  bots  <-  ui / server / tools
// Only src/api may import src/engine, and bots may import nothing but src/api (and each other).

const root = resolve(__dirname, '..');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** Project-relative paths (with forward slashes) of the local modules a file imports. */
function imports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of source.matchAll(/(?:import|export)[^'"]*?from\s+['"](\.[^'"]+)['"]/g))
    out.push(relative(root, resolve(file, '..', m[1])).split(sep).join('/'));
  return out;
}

const layer = (path: string) => path.split('/').slice(0, 2).join('/');
const sources = (dir: string) => files(join(root, dir)).map((f) => ({ file: relative(root, f).split(sep).join('/'), deps: imports(f) }));

describe('architecture', () => {
  it('only the API imports the engine', () => {
    for (const dir of ['src/bots', 'src/ui', 'src/server', 'tools'])
      for (const { file, deps } of sources(dir))
        for (const dep of deps) expect(layer(dep), `${file} imports ${dep}`).not.toBe('src/engine');
  });

  it('bots depend on the API only', () => {
    for (const { file, deps } of sources('src/bots'))
      for (const dep of deps) expect(['src/api', 'src/bots'], `${file} imports ${dep}`).toContain(layer(dep));
  });

  it('the engine and the API know nothing of bots, interface or server', () => {
    for (const dir of ['src/engine', 'src/api'])
      for (const { file, deps } of sources(dir))
        for (const dep of deps) expect(['src/engine', 'src/api'], `${file} imports ${dep}`).toContain(layer(dep));
  });

  it('the engine does not import the API', () => {
    for (const { file, deps } of sources('src/engine'))
      for (const dep of deps) expect(layer(dep), `${file} imports ${dep}`).toBe('src/engine');
  });

  it('nothing outside the browser interface touches the DOM or browser storage', () => {
    for (const dir of ['src/engine', 'src/api', 'src/bots'])
      for (const { file } of sources(dir))
        expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(/\b(document|window|localStorage)\./);
  });
});
