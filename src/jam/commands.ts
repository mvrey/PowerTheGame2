import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gamePackage, GAMES } from '../games';
import { GamePackage, Language, LANGUAGES } from '../platform/core/bots';
import { seatsOf } from '../platform/core/game';
import { randomSeed } from '../platform/core/random';
import { Replay } from '../platform/core/replay';
import { verifyReplay } from '../platform/core/verify';
import { contentHash, readManifest } from '../platform/node/manifest';
import { playMatch } from '../platform/node/match';
import { DEFAULT_DOCKER, DockerRunner, LocalRunner, Runner, resolveBot } from '../platform/node/runners';
import { serveStatic } from '../platform/node/serve';
import { readJson, readJsonIfExists, writeJsonAtomic } from '../platform/node/store';
import { unpackSubmissionFile } from '../platform/node/submission';
import { FILES, LiveStatus, TournamentFile, runTournament, tournamentBaseDir } from '../platform/node/tournament';
import { Args, UsageError, integerOption, option } from './args';
import { describeFailures, describeReplay, describeStatus } from './report';

export interface Command {
  usage: string;
  flags?: string[];
  run(args: Args): Promise<number>;
}

const game = (args: Args): GamePackage => gamePackage(option(args, 'game', GAMES[0].game.id)!);

function runnerFrom(args: Args): Runner {
  const kind = option(args, 'runner', 'local');
  if (kind === 'local') return new LocalRunner();
  if (kind !== 'docker') throw new UsageError('--runner: local or docker');
  const runtime = option(args, 'runtime', DEFAULT_DOCKER.runtime ?? 'none')!;
  return new DockerRunner({ ...DEFAULT_DOCKER, runtime: runtime === 'none' ? null : runtime });
}

const limitsFrom = (args: Args) => ({
  ...(args.options.has('turn-ms') && { turnMs: integerOption(args, 'turn-ms', 0) }),
  ...(args.options.has('startup-ms') && { startupMs: integerOption(args, 'startup-ms', 0) }),
});

export const COMMANDS: Record<string, Command> = {
  games: {
    usage: 'games                                  the games, their formats, variants and built-in bots',
    async run() {
      for (const { game: g, summary, builtins } of GAMES) {
        console.log(`${g.id} ${g.version} — ${g.title}: ${summary}`);
        console.log(`  formats:  ${g.formats.map((f) => `${f.id} (${f.players})`).join(', ')}`);
        console.log(`  variants: ${g.variants.join(', ')}`);
        console.log(`  built-in: ${builtins.map((b) => `builtin:${b.id}`).join(', ')}`);
      }
      return 0;
    },
  },

  match: {
    usage:
      'match --bot <bot> --bot <bot> [...]    play one match; bots are folders or builtin:<id>\n' +
      '      [--game power] [--format duel] [--variant classic] [--turns 60] [--seed n]\n' +
      '      [--runner local|docker] [--runtime runsc|none] [--turn-ms 2000] [--out replay.json]',
    async run(args) {
      const pkg = game(args);
      const specs = args.options.get('bot') ?? [];
      const format = option(args, 'format') ?? pkg.game.formats.find((f) => f.players === specs.length)?.id;
      if (!format || seatsOf(pkg.game, format) !== specs.length)
        throw new UsageError(
          `give one --bot per seat (${pkg.game.formats.map((f) => `${f.id}: ${f.players}`).join(', ')})`,
        );
      const replay = await playMatch({
        pkg,
        runner: runnerFrom(args),
        bots: specs.map((spec) => resolveBot(spec, pkg)),
        setup: {
          format,
          variant: option(args, 'variant', pkg.defaults.variants[0])!,
          maxTurns: integerOption(args, 'turns', pkg.defaults.maxTurns),
          seed: integerOption(args, 'seed', randomSeed()),
        },
        matchId: `match-${Date.now().toString(36)}`,
        limits: limitsFrom(args),
        onTurn: (record) => process.stdout.isTTY && process.stdout.write(`\rturn ${record.turn}`),
      });
      if (process.stdout.isTTY) process.stdout.write('\r');
      const out = option(args, 'out', 'replay.json')!;
      writeJsonAtomic(out, replay);
      console.log(describeReplay(replay));
      console.log(`Replay: ${out} (watch it with "npm run jam -- serve")`);
      return 0;
    },
  },

  check: {
    usage: 'check <bot folder> [--game power] [--turns 12]   validate a bot and play it from both seats',
    async run(args) {
      const pkg = game(args);
      const dir = args.positional[0];
      if (!dir) throw new UsageError('which bot folder?');
      const manifest = readManifest(dir);
      console.log(`${manifest.name}: ${manifest.language}, ${manifest.entry}, ${contentHash(dir)}`);
      const duel = pkg.game.formats.find((f) => f.players === 2)!;
      const opponent = `builtin:${pkg.defaults.sparring}`;
      let failed = false;
      for (const seat of [0, 1]) {
        const specs = seat === 0 ? [dir, opponent] : [opponent, dir];
        const replay = await playMatch({
          pkg,
          runner: new LocalRunner(),
          bots: specs.map((spec) => resolveBot(spec, pkg)),
          setup: {
            format: duel.id,
            variant: pkg.defaults.variants[0],
            maxTurns: integerOption(args, 'turns', 12),
            seed: 1,
          },
          matchId: `check-${seat}`,
          limits: limitsFrom(args),
        });
        const diagnostics = replay.diagnostics[seat];
        const refused = replay.turns.flatMap((t) => t.problems[seat]).map((p) => p.code);
        const times = replay.turns.map((t) => t.ms[seat]).filter((ms): ms is number => ms !== null);
        console.log(
          `\nAs seat ${seat} against ${replay.bots[1 - seat].name}: rank ${replay.result.placements[seat].rank}`,
        );
        console.log(
          `  answers: ${describeFailures(diagnostics.failures)}; slowest ${times.length ? Math.max(...times) : '—'} ms`,
        );
        if (refused.length)
          console.log(
            `  refused: ${[...new Set(refused)].map((c) => `${c} ×${refused.filter((r) => r === c).length}`).join(', ')}`,
          );
        if (diagnostics.stderr.trim())
          console.log(`  stderr (end): ${diagnostics.stderr.trim().split('\n').slice(-5).join('\n    ')}`);
        failed ||= !diagnostics.ready || Object.keys(diagnostics.failures).length > 0;
      }
      console.log(failed ? '\nProblems found: see above.' : '\nAll good: the bot answered every turn in time.');
      return failed ? 1 : 0;
    },
  },

  new: {
    usage: 'new <python|javascript> <folder> [--game power]   start a bot from the starter template',
    async run(args) {
      const pkg = game(args);
      const [language, folder] = args.positional as [Language, string];
      if (!LANGUAGES.includes(language) || !folder) throw new UsageError(`new <${LANGUAGES.join('|')}> <folder>`);
      const template = pkg.templates[language];
      if (!template) throw new UsageError(`${pkg.game.id} has no ${language} template`);
      if (existsSync(folder) && readdirSync(folder).length) throw new UsageError(`${folder} is not empty`);
      cpSync(template.dir, folder, { recursive: true });
      const manifestPath = join(folder, 'bot.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.name =
        basename(resolve(folder))
          .replace(/[^\p{L}\p{N} ._-]/gu, '-')
          .slice(0, 32) || manifest.name;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      console.log(`Created ${folder}. Try it: npm run jam -- check ${folder}`);
      return 0;
    },
  },

  unpack: {
    usage: 'unpack <submission.zip> <folder>      unpack a submission safely and check its manifest',
    async run(args) {
      const [zip, folder] = args.positional;
      if (!zip || !folder) throw new UsageError('unpack <submission.zip> <folder>');
      const manifest = unpackSubmissionFile(zip, folder);
      console.log(`${manifest.name} (${manifest.language}) unpacked into ${folder}: ${contentHash(folder)}`);
      return 0;
    },
  },

  tournament: {
    usage: 'tournament <tournament.json> [--out folder]   run (or resume) a tournament',
    async run(args) {
      const path = args.positional[0];
      if (!path) throw new UsageError('which tournament file?');
      const file = readJson<TournamentFile>(path);
      const outDir = option(args, 'out', join('tournaments', file.id))!;
      const status = await runTournament(file, gamePackage(file.game), {
        outDir,
        baseDir: tournamentBaseDir(path),
        log: (line) => console.log(line),
      });
      console.log('\n' + describeStatus(status));
      return 0;
    },
  },

  status: {
    usage: 'status <tournament folder>             standings, bracket and ranking so far',
    async run(args) {
      const status = readJsonIfExists<LiveStatus>(join(args.positional[0] ?? '.', FILES.live));
      if (!status) throw new UsageError(`no ${FILES.live} there`);
      console.log(describeStatus(status));
      return 0;
    },
  },

  verify: {
    usage: 'verify <replay.json | tournament folder>...   play replays again and compare',
    async run(args) {
      const files = args.positional.flatMap((path) =>
        statSync(path).isDirectory()
          ? readdirSync(join(path, FILES.replays))
              .filter((f) => f.endsWith('.json'))
              .map((f) => join(path, FILES.replays, f))
          : [path],
      );
      let bad = 0;
      for (const file of files) {
        const replay = readJson<Replay>(file);
        const verdict = verifyReplay(gamePackage(replay.game.id).game, replay);
        if (!verdict.ok) bad++;
        console.log(`${verdict.ok ? 'ok  ' : 'FAIL'} ${file}${verdict.ok ? '' : ': ' + verdict.problems.join('; ')}`);
      }
      console.log(`${files.length - bad} of ${files.length} replays verified`);
      return bad ? 1 : 0;
    },
  },

  serve: {
    usage:
      'serve [folder] [--port 8080] [--host 127.0.0.1]   the spectator viewer, with a folder of replays or a tournament',
    async run(args) {
      const viewer = resolve('dist/viewer');
      if (!existsSync(join(viewer, 'index.html'))) throw new UsageError('build the viewer first: npm run build');
      const data = resolve(args.positional[0] ?? '.');
      const port = integerOption(args, 'port', 8080);
      const host = option(args, 'host', '127.0.0.1')!;
      // The games' sounds live next to the game build (dist/audio).
      await serveStatic({ '/': viewer, '/audio/': resolve('dist/audio'), '/data/': data }, port, host);
      const base = `http://${host}:${port}/`;
      console.log(`Viewer on ${base}`);
      if (existsSync(join(data, FILES.live))) console.log(`Tournament:  ${base}?tournament=data/${FILES.live}`);
      else console.log(`A replay:    ${base}?replay=data/<file>.json`);
      console.log('Ctrl+C to stop.');
      return new Promise(() => {});
    },
  },
};
