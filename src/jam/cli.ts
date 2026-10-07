// The `jam` command: everything participants and organizers do with the platform.
// Run it with `npm run jam -- <command> ...`; `npm run jam -- help` lists the commands.

import { ManifestError } from '../platform/node/manifest';
import { SubmissionError } from '../platform/node/submission';
import { UsageError, parseArgs } from './args';
import { COMMANDS } from './commands';

function help(): void {
  console.log('Usage: npm run jam -- <command> [options]\n');
  for (const command of Object.values(COMMANDS)) console.log('  ' + command.usage.replace(/\n/g, '\n  ') + '\n');
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  const command = name ? COMMANDS[name] : undefined;
  if (!command) {
    help();
    return name && name !== 'help' ? 2 : 0;
  }
  try {
    return await command.run(parseArgs(rest, command.flags));
  } catch (error) {
    if (error instanceof UsageError) console.error(`${error.message}\n\nUsage: npm run jam -- ${command.usage}`);
    else if (error instanceof ManifestError || error instanceof SubmissionError)
      console.error(`Invalid bot: ${error.message}`);
    else console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

// vite-node forwards everything after the script; a leading "--" from npm is not ours.
const args = process.argv.slice(2);
main(args[0] === '--' ? args.slice(1) : args).then((code) => process.exit(code));
