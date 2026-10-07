import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { SubmissionError, unpackSubmission } from '../../src/platform/node/submission';

interface ZipFile {
  name: string;
  content?: string | Buffer;
  /** Lie about the unpacked size in the headers. */
  declaredSize?: number;
  unixMode?: number;
  encrypted?: boolean;
}

/** A minimal zip writer (deflate), able to produce the malicious archives the reader must refuse. */
function zip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const content = Buffer.from(file.content ?? '');
    const data = deflateRawSync(content);
    const name = Buffer.from(file.name);
    const size = file.declaredSize ?? content.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(file.encrypted ? 1 : 0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(content), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(file.encrypted ? 1 : 0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(content), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((file.unixMode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const manifest = JSON.stringify({ name: 'Zipped', language: 'python', entry: 'main.py' });
const fresh = () => join(mkdtempSync(join(tmpdir(), 'jam-zip-')), 'bot');

describe('submissions', () => {
  it('unpacks a bot, unwrapping a zipped folder', () => {
    const dir = fresh();
    const bot = unpackSubmission(
      zip([
        { name: 'mine/bot.json', content: manifest },
        { name: 'mine/main.py', content: 'print(1)' },
      ]),
      dir,
    );
    expect(bot.name).toBe('Zipped');
    expect(readFileSync(join(dir, 'main.py'), 'utf8')).toBe('print(1)');
  });

  it.each([
    ['a name that climbs out', [{ name: '../evil.py', content: 'x' }]],
    ['an absolute name', [{ name: '/etc/cron.d/evil', content: 'x' }]],
    ['a Windows path', [{ name: 'C:\\evil.py', content: 'x' }]],
    ['a link', [{ name: 'link', content: '/etc/passwd', unixMode: 0o120777 }]],
    ['an encrypted file', [{ name: 'main.py', content: 'x', encrypted: true }]],
    ['too many files', Array.from({ length: 201 }, (_, i) => ({ name: `f${i}.py`, content: 'x' }))],
    ['too many bytes', [{ name: 'big.bin', content: 'x', declaredSize: 6 << 20 }]],
    ['a size that lies (zip bomb)', [{ name: 'bomb.txt', content: Buffer.alloc(1 << 20), declaredSize: 100 }]],
  ] as [string, ZipFile[]][])('refuses %s', (_what, files) => {
    expect(() => unpackSubmission(zip([{ name: 'bot.json', content: manifest }, ...files]), fresh())).toThrow(
      SubmissionError,
    );
  });

  it('refuses what is not a zip, and a bot without a valid manifest', () => {
    expect(() => unpackSubmission(Buffer.from('hello'), fresh())).toThrow(/not a zip/);
    expect(() => unpackSubmission(zip([{ name: 'main.py', content: 'x' }]), fresh())).toThrow(/bot.json/);
  });
});
