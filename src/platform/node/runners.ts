import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { BuiltinBot, GamePackage } from '../core/bots';
import { connectInProcess } from '../core/inProcess';
import { Limits } from '../core/protocol';
import { BotLauncher } from '../core/referee';
import { LANGUAGE_PROFILES } from './languages';
import { BotManifest, contentHash, readManifest } from './manifest';
import { connectProcess, killTree } from './processConnection';

/** A bot ready to be launched: a participant's folder, or one of the game's built-in bots. */
export interface ResolvedBot {
  /** The folder name for submissions, "builtin:<id>" for built-in bots. */
  id: string;
  name: string;
  /** Content hash of a submission; the game version for a built-in bot. */
  version: string;
  source: { kind: 'process'; dir: string; manifest: BotManifest } | { kind: 'builtin'; bot: BuiltinBot };
}

/** Finds a bot from a command-line or configuration spec: "builtin:okoye:3" or a folder path. */
export function resolveBot(spec: string, pkg: GamePackage): ResolvedBot {
  if (spec.startsWith('builtin:')) {
    const wanted = spec.slice('builtin:'.length);
    const bot = pkg.builtins.find((b) => b.id === wanted) ?? pkg.builtins.find((b) => b.id === `${wanted}:2`);
    if (!bot) throw new Error(`no built-in bot "${wanted}"; there are ${pkg.builtins.map((b) => b.id).join(', ')}`);
    return {
      id: `builtin:${bot.id}`,
      name: bot.name,
      version: `${pkg.game.id}-${pkg.game.version}`,
      source: { kind: 'builtin', bot },
    };
  }
  const dir = resolve(spec);
  const manifest = readManifest(dir);
  return {
    id: basename(dir),
    name: manifest.name,
    version: contentHash(dir),
    source: { kind: 'process', dir, manifest },
  };
}

/** Starts bots for matches. Built-in bots (trusted) always run in the referee's process. */
export interface Runner {
  readonly description: string;
  launcher(bot: ResolvedBot, match: { id: string; seat: number }, limits: Limits): BotLauncher;
}

/**
 * Runs bots as plain child processes of the referee, with a clean environment and output limits,
 * but WITHOUT isolation: for participants testing their own bot, never for untrusted code.
 */
export class LocalRunner implements Runner {
  readonly description = 'local processes (no sandbox)';

  launcher(bot: ResolvedBot, _match: { id: string; seat: number }, limits: Limits): BotLauncher {
    const source = bot.source;
    if (source.kind === 'builtin') return async () => connectInProcess(source.bot.create());
    return async () => {
      const [command, ...args] = LANGUAGE_PROFILES[source.manifest.language].localCommand(source.manifest.entry);
      const child = spawn(command, args, { cwd: source.dir, env: botEnvironment(), stdio: 'pipe', windowsHide: true });
      return connectProcess(child, { limits });
    };
  }
}

/** The variables a bot process gets: enough to run, and no secrets of the organizer. */
function botEnvironment(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'];
  const env: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8', LANG: 'C.UTF-8' };
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

export interface DockerOptions {
  /** The docker CLI (or a compatible one, such as podman). */
  command: string;
  /** OCI runtime: "runsc" for gVisor (recommended), or null for the default runtime. */
  runtime: string | null;
  memory: string;
  cpus: string;
  pids: number;
  /** Size of the writable /tmp, in MiB. */
  tmpfsMb: number;
  /** Runtime images by language, overriding the defaults (pin them by digest for a tournament). */
  images: Partial<Record<BotManifest['language'], string>>;
}

export const DEFAULT_DOCKER: DockerOptions = {
  command: 'docker',
  runtime: 'runsc',
  memory: '256m',
  cpus: '1',
  pids: 64,
  tmpfsMb: 16,
  images: {},
};

/**
 * The `docker run` arguments that start one bot: no network, read-only everything, an
 * unprivileged user, no capabilities, no privilege escalation, and limits on memory (no swap),
 * CPU, processes, open files and scratch space. See Docs/Sandbox.md for the threat model.
 */
export function dockerRunArgs(
  o: DockerOptions,
  bot: { dir: string; manifest: BotManifest },
  containerName: string,
): string[] {
  const profile = LANGUAGE_PROFILES[bot.manifest.language];
  return [
    'run',
    '--rm',
    '--interactive',
    '--init',
    '--name',
    containerName,
    ...(o.runtime ? ['--runtime', o.runtime] : []),
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    `/tmp:rw,noexec,nosuid,nodev,size=${o.tmpfsMb}m`,
    '--mount',
    `type=bind,source=${bot.dir},target=/bot,readonly`,
    '--workdir',
    '/bot',
    '--user',
    '65534:65534',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--memory',
    o.memory,
    '--memory-swap',
    o.memory,
    '--cpus',
    o.cpus,
    '--pids-limit',
    String(o.pids),
    '--ulimit',
    'nofile=64:64',
    '--ulimit',
    `fsize=${o.tmpfsMb << 20}`,
    '--log-driver',
    'none',
    '--env',
    'PYTHONIOENCODING=utf-8',
    o.images[bot.manifest.language] ?? profile.image,
    ...profile.sandboxCommand(bot.manifest.entry),
  ];
}

/** Runs every participant bot in its own hardened container (one per bot per match). */
export class DockerRunner implements Runner {
  readonly description: string;

  constructor(private readonly options: DockerOptions = DEFAULT_DOCKER) {
    this.description = `docker${options.runtime ? ` (${options.runtime})` : ''}`;
  }

  launcher(bot: ResolvedBot, match: { id: string; seat: number }, limits: Limits): BotLauncher {
    const source = bot.source;
    if (source.kind === 'builtin') return async () => connectInProcess(source.bot.create());
    return async () => {
      const name = containerName(match.id, match.seat);
      const child = spawn(this.options.command, dockerRunArgs(this.options, source, name), {
        stdio: 'pipe',
        windowsHide: true,
      });
      const kill = () => {
        spawnSync(this.options.command, ['kill', name], { stdio: 'ignore', windowsHide: true });
        killTree(child);
      };
      return connectProcess(child, { limits, kill });
    };
  }
}

/** A container name that is unique and safe whatever the match id holds. */
export function containerName(matchId: string, seat: number): string {
  return `jam-${matchId.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 40)}-s${seat}-${randomBytes(3).toString('hex')}`;
}

/** Whether a docker CLI that can talk to a daemon is installed here. */
export function dockerAvailable(command = 'docker'): boolean {
  const probe = spawnSync(command, ['info', '--format', '{{.ServerVersion}}'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 5000,
  });
  return probe.status === 0;
}
