import { Language } from '../core/bots';

/** How a language's bots are started: on the organizer's machine, and inside the sandbox. */
export interface LanguageProfile {
  /** File extensions an entry point may have. */
  extensions: readonly string[];
  /** Command for the local runner (development only: no isolation). */
  localCommand(entry: string): string[];
  /** Default runtime image of the sandbox (see sandbox/docker). */
  image: string;
  /** Command inside the sandbox, run from /bot. */
  sandboxCommand(entry: string): string[];
}

/**
 * Python runs with -u (unbuffered: answers must not sit in a buffer), -B (no .pyc files: the bot
 * folder is read-only), -E and -s (ignore PYTHON* variables and user site-packages). Bots get the
 * standard library only.
 */
const python: LanguageProfile = {
  extensions: ['.py'],
  localCommand: (entry) => [
    process.env.JAM_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'),
    '-u',
    '-B',
    '-E',
    '-s',
    entry,
  ],
  image: 'jam-runtime-python:3.12',
  sandboxCommand: (entry) => ['python3', '-u', '-B', '-E', '-s', entry],
};

/** JavaScript bots are ES modules (.mjs), so no package.json can change how they load. */
const javascript: LanguageProfile = {
  extensions: ['.mjs'],
  localCommand: (entry) => [process.execPath, entry],
  image: 'jam-runtime-node:22',
  sandboxCommand: (entry) => ['node', entry],
};

export const LANGUAGE_PROFILES: Record<Language, LanguageProfile> = { python, javascript };
