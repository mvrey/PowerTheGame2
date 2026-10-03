// Starts the Power HTTP server. Usage: npm run server [-- port=8787]
import { bots } from '../bots';
import { parseArgs } from '../cli/args';
import { createApiServer } from './http';
import { MatchService } from './matchService';

const port = Number(parseArgs().get('port') ?? process.env.PORT ?? 8787);

const service = new MatchService({ registry: bots, log: (m) => console.log(m) });
const server = createApiServer({ service, registry: bots });
server.listen(port, () => {
  console.log(`Power server on http://localhost:${port}/api`);
  console.log(
    `Bots: ${bots
      .list()
      .map((b) => b.id)
      .join(', ')}`,
  );
});

const stop = () => {
  service.close();
  server.close(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
