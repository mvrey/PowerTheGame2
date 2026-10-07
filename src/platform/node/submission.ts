import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { BotManifest, MANIFEST_FILE, SUBMISSION_LIMITS, readManifest } from './manifest';

// Unpacks a participant's zip into a fresh folder. Everything in the archive is hostile until
// checked: names that climb out of the folder, links, encryption, unusual compression, more
// files or bytes than a bot needs, and sizes that lie (zip bombs) are all refused.

export class SubmissionError extends Error {}

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  localOffset: number;
  directory: boolean;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** Reads the central directory of a zip, refusing anything a plain bot folder would not contain. */
export function listZip(zip: Buffer): Entry[] {
  const end = findEndOfDirectory(zip);
  const count = zip.readUInt16LE(end + 10);
  const offset = zip.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new SubmissionError('zip64 archives are not accepted');
  if (count > SUBMISSION_LIMITS.maxFiles) throw new SubmissionError(`more than ${SUBMISSION_LIMITS.maxFiles} files`);
  const entries: Entry[] = [];
  let at = offset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== CENTRAL) throw new SubmissionError('broken zip directory');
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const unixMode = zip.readUInt32LE(at + 38) >>> 16;
    const localOffset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;

    if (flags & 1) throw new SubmissionError(`${name}: encrypted files are not accepted`);
    if ((unixMode & S_IFMT) === S_IFLNK) throw new SubmissionError(`${name}: links are not accepted`);
    if (!safeName(name)) throw new SubmissionError(`${JSON.stringify(name)}: not a plain relative path`);
    const directory = name.endsWith('/');
    if (!directory && method !== STORED && method !== DEFLATED)
      throw new SubmissionError(`${name}: unsupported compression`);
    total += size;
    if (total > SUBMISSION_LIMITS.maxBytes)
      throw new SubmissionError(`more than ${SUBMISSION_LIMITS.maxBytes} bytes unpacked`);
    entries.push({ name, method, compressedSize, size, crc, localOffset, directory });
  }
  return entries;
}

/**
 * Unpacks a zip into `destination`, which must not exist or be empty, and checks the bot's
 * manifest. A single top folder in the archive (a zipped folder) is unwrapped.
 */
export function unpackSubmission(zip: Buffer, destination: string): BotManifest {
  if (existsSync(destination) && readdirSync(destination).length)
    throw new SubmissionError(`${destination} is not empty`);
  const entries = listZip(zip);
  const prefix = commonTopFolder(entries);
  for (const entry of entries) {
    if (entry.directory) continue;
    const target = join(destination, ...entry.name.slice(prefix.length).split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readEntry(zip, entry), { flag: 'wx' });
  }
  return readManifest(destination);
}

export function unpackSubmissionFile(zipPath: string, destination: string): BotManifest {
  return unpackSubmission(readFileSync(zipPath), destination);
}

function readEntry(zip: Buffer, entry: Entry): Buffer {
  const at = entry.localOffset;
  if (at + 30 > zip.length || zip.readUInt32LE(at) !== LOCAL) throw new SubmissionError(`${entry.name}: broken entry`);
  const start = at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28);
  const data = zip.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) throw new SubmissionError(`${entry.name}: truncated`);
  let content: Buffer;
  try {
    // Inflating stops one byte past the declared size, so a lying header cannot blow up memory.
    content = entry.method === STORED ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: entry.size + 1 });
  } catch {
    throw new SubmissionError(`${entry.name}: cannot be decompressed within its declared size`);
  }
  if (content.length !== entry.size || crc32(content) !== entry.crc)
    throw new SubmissionError(`${entry.name}: corrupted`);
  return content;
}

function findEndOfDirectory(zip: Buffer): number {
  const lowest = Math.max(0, zip.length - 22 - 0xffff);
  for (let at = zip.length - 22; at >= lowest; at--) if (zip.readUInt32LE(at) === EOCD) return at;
  throw new SubmissionError('not a zip archive');
}

/** A relative path with forward slashes that stays inside its folder. */
function safeName(name: string): boolean {
  if (!name || name.includes('\\') || name.includes('\0') || name.includes(':') || name.startsWith('/')) return false;
  // Already in normal form ("a/./b", "a//b" are refused too) and never climbing up.
  return posix.normalize(name) === name && !name.split('/').includes('..');
}

/** "mybot/" when every entry lives in one top folder and the manifest is not at the root. */
function commonTopFolder(entries: Entry[]): string {
  if (entries.some((e) => e.name === MANIFEST_FILE)) return '';
  const tops = new Set(entries.map((e) => e.name.split('/')[0]));
  const [top] = tops;
  return tops.size === 1 && entries.every((e) => e.name.startsWith(top + '/')) ? top + '/' : '';
}
