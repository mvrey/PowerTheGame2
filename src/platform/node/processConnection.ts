import { ChildProcessWithoutNullStreams, spawnSync } from 'node:child_process';
import { Limits } from '../core/protocol';
import { BotConnection, Received } from '../core/referee';
import { CappedText, LineSplitter } from './lines';

/** Messages a bot may have waiting before it counts as flooding the referee. */
const MAX_QUEUED_MESSAGES = 64;
/** How long a bot gets to exit by itself once its input is closed. */
const EXIT_GRACE_MS = 500;
/** Longest wait for a killed process to be reported gone. */
const KILL_WAIT_MS = 3000;

export interface ProcessOptions {
  limits: Pick<Limits, 'maxMessageBytes' | 'maxStderrBytes'>;
  /** Stops the bot for good (the default kills the process tree). */
  kill?: () => void;
}

/**
 * The protocol over a child process: JSON lines on stdin/stdout, stderr kept up to a limit.
 * Oversized lines, a flood of messages or an exit end the connection; writes after that are dropped.
 */
export function connectProcess(child: ChildProcessWithoutNullStreams, options: ProcessOptions): BotConnection {
  const lines = new LineSplitter(options.limits.maxMessageBytes);
  const stderr = new CappedText(options.limits.maxStderrBytes);
  const inbox: Received[] = [];
  let waiter: ((received: Received) => void) | null = null;
  let gone: string | null = null;
  let exited: string | null = null;
  const exitWaiters: (() => void)[] = [];

  const kill = options.kill ?? (() => killTree(child));
  const deliver = (received: Received) => {
    if (waiter) {
      const wake = waiter;
      waiter = null;
      wake(received);
    } else inbox.push(received);
  };
  const end = (reason: string) => {
    if (gone) return;
    gone = reason;
    deliver({ kind: 'closed', reason });
  };
  const stop = (reason: string) => {
    end(reason);
    kill();
  };

  child.stdout.on('data', (chunk: Buffer) => {
    if (gone) return;
    const result = lines.push(chunk);
    if (result === 'overflow') return stop('wrote a line longer than the limit');
    for (const line of result) {
      if (!line.trim()) continue;
      try {
        deliver({ kind: 'message', value: JSON.parse(line) });
      } catch {
        deliver({ kind: 'invalid', reason: `not JSON: ${line.slice(0, 80)}` });
      }
    }
    if (inbox.length > MAX_QUEUED_MESSAGES) stop('flooded its output');
  });
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.stdin.on('error', () => {}); // Writing to a bot that already exited is not an error of ours.
  child.on('error', (error) => end(`could not run: ${error.message}`));
  child.on('exit', (code, signal) => {
    exited = signal ? `signal ${signal}` : `exit code ${code}`;
    end(`exited (${exited})`);
    exitWaiters.splice(0).forEach((wake) => wake());
  });

  const waitExit = (ms: number) =>
    new Promise<void>((resolve) => {
      if (exited) return resolve();
      const timer = setTimeout(resolve, ms);
      exitWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });

  return {
    send(message) {
      if (gone || !child.stdin.writable) return;
      child.stdin.write(JSON.stringify(message) + '\n');
    },

    receive(timeoutMs) {
      if (inbox.length) return Promise.resolve(inbox.shift()!);
      if (gone) return Promise.resolve({ kind: 'closed', reason: gone });
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiter = null;
          resolve({ kind: 'timeout' });
        }, timeoutMs);
        waiter = (received) => {
          clearTimeout(timer);
          resolve(received);
        };
      });
    },

    async close() {
      // Why the referee ended it, if it did (an exit by itself needs no explanation).
      let reason = gone && !gone.startsWith('exited') ? gone : null;
      if (!exited) {
        child.stdin.end();
        await waitExit(EXIT_GRACE_MS);
      }
      if (!exited) {
        reason ??= 'stopped by the referee';
        end(reason);
        kill();
        await waitExit(KILL_WAIT_MS);
      }
      const how = exited ?? 'did not exit after being killed';
      return { exit: reason ? `${reason}; ${how}` : how, stderr: stderr.toString() };
    },
  };
}

/** Kills a process and everything it started (on Windows, `kill` alone leaves children behind). */
export function killTree(child: { pid?: number; kill: (signal?: NodeJS.Signals) => boolean }): void {
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  }
  child.kill('SIGKILL');
}
