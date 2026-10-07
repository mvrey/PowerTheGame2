import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { LANGUAGES, Language } from '../core/bots';
import { isRecord } from '../core/json';
import { LANGUAGE_PROFILES } from './languages';

/** The file that describes a bot, at the root of its folder. */
export const MANIFEST_FILE = 'bot.json';

export interface BotManifest {
  /** Shown in standings and on stream: 1–32 letters, digits, spaces, dots, dashes, underscores. */
  name: string;
  language: Language;
  /** The file to run, relative to the bot folder. */
  entry: string;
  author?: string;
}

/** Limits on a bot folder: it holds source code, nothing big. */
export const SUBMISSION_LIMITS = { maxFiles: 200, maxBytes: 5 << 20 };

export class ManifestError extends Error {}

const NAME = /^[\p{L}\p{N} ._-]{1,32}$/u;

/** Reads and checks a bot's manifest. Every value comes from a participant: nothing is trusted. */
export function readManifest(dir: string): BotManifest {
  const path = join(dir, MANIFEST_FILE);
  let raw: unknown;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 4096) throw new ManifestError(`${MANIFEST_FILE} must be a small regular file`);
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    throw new ManifestError(`cannot read ${MANIFEST_FILE}: ${error instanceof Error ? error.message : error}`);
  }
  if (!isRecord(raw)) throw new ManifestError(`${MANIFEST_FILE} must hold a JSON object`);
  const { name, language, entry, author } = raw;
  if (typeof name !== 'string' || !NAME.test(name.trim()) || name.trim() !== name)
    throw new ManifestError('name: 1 to 32 letters, digits, spaces, dots, dashes or underscores');
  if (typeof language !== 'string' || !LANGUAGES.includes(language as Language))
    throw new ManifestError(`language: one of ${LANGUAGES.join(', ')}`);
  if (typeof entry !== 'string' || !isInside(entry)) throw new ManifestError('entry: a path inside the bot folder');
  const profile = LANGUAGE_PROFILES[language as Language];
  if (!profile.extensions.includes(extname(entry)))
    throw new ManifestError(`entry: a ${profile.extensions.join(' or ')} file`);
  let entryStat;
  try {
    entryStat = lstatSync(join(dir, entry));
  } catch {
    throw new ManifestError(`entry: ${entry} does not exist`);
  }
  if (!entryStat.isFile()) throw new ManifestError(`entry: ${entry} is not a regular file`);
  if (author !== undefined && (typeof author !== 'string' || author.length > 64))
    throw new ManifestError('author: up to 64 characters');
  return {
    name,
    language: language as Language,
    entry: normalize(entry).split(sep).join('/'),
    author: author as string | undefined,
  };
}

/** A relative path that stays inside its folder. */
function isInside(path: string): boolean {
  if (!path || isAbsolute(path) || /^[a-zA-Z]:/.test(path) || path.includes('\0')) return false;
  const normalized = normalize(path);
  return !normalized.startsWith('..') && !relative('.', normalized).startsWith('..');
}

/**
 * A fingerprint of everything in a bot folder (paths and contents), so that a replay names the
 * exact code that played. Refuses links and oversized folders.
 */
export function contentHash(dir: string): string {
  const hash = createHash('sha256');
  let files = 0;
  let bytes = 0;
  const walk = (folder: string) => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new ManifestError(`${relative(dir, path)}: links are not allowed`);
      if (stat.isDirectory()) {
        if (name === '__pycache__') continue;
        walk(path);
        continue;
      }
      if (++files > SUBMISSION_LIMITS.maxFiles)
        throw new ManifestError(`more than ${SUBMISSION_LIMITS.maxFiles} files`);
      bytes += stat.size;
      if (bytes > SUBMISSION_LIMITS.maxBytes) throw new ManifestError(`more than ${SUBMISSION_LIMITS.maxBytes} bytes`);
      hash.update(relative(dir, path).split(sep).join('/')).update('\0').update(readFileSync(path)).update('\0');
    }
  };
  walk(dir);
  return 'sha256-' + hash.digest('hex').slice(0, 16);
}
