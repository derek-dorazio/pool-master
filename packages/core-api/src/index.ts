import Fastify from 'fastify';
import { healthPlugin } from './plugins/health';
import { leaguesModule } from './modules/leagues/routes';

export function buildApp() {
  const app = Fastify({ logger: true });

  // Core plugins
  app.register(healthPlugin);

  // Domain modules
  app.register(leaguesModule, { prefix: '/api/v1/leagues' });

  return app;
}

async function start(): Promise<void> {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3000);

  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
