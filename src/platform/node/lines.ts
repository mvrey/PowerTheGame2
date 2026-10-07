/**
 * Splits a byte stream into lines, refusing any line longer than `maxBytes` (a bot must not be
 * able to make the referee buffer unbounded output).
 */
export class LineSplitter {
  private chunks: Buffer[] = [];
  private pending = 0;

  constructor(private readonly maxBytes: number) {}

  /** The complete lines in `chunk`, or 'overflow' once a line grows past the limit. */
  push(chunk: Buffer): string[] | 'overflow' {
    const lines: string[] = [];
    let start = 0;
    for (let newline = chunk.indexOf(10); newline !== -1; newline = chunk.indexOf(10, start)) {
      const piece = chunk.subarray(start, newline);
      if (this.pending + piece.length > this.maxBytes) return 'overflow';
      lines.push(
        Buffer.concat([...this.chunks, piece])
          .toString('utf8')
          .replace(/\r$/, ''),
      );
      this.chunks = [];
      this.pending = 0;
      start = newline + 1;
    }
    const rest = chunk.subarray(start);
    this.pending += rest.length;
    if (this.pending > this.maxBytes) return 'overflow';
    if (rest.length) this.chunks.push(rest);
    return lines;
  }
}

/** Keeps the first `maxBytes` of a stream and counts the rest. */
export class CappedText {
  private chunks: Buffer[] = [];
  private kept = 0;
  private dropped = 0;

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): void {
    const room = this.maxBytes - this.kept;
    if (room > 0) {
      const part = chunk.subarray(0, room);
      this.chunks.push(part);
      this.kept += part.length;
    }
    this.dropped += Math.max(0, chunk.length - Math.max(room, 0));
  }

  toString(): string {
    const text = Buffer.concat(this.chunks).toString('utf8');
    return this.dropped ? `${text}\n[… ${this.dropped} more bytes not kept]` : text;
  }
}
