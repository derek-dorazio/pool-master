import Fastify from 'fastify';
import { healthPlugin } from './plugins/health';
import { leaguesModule } from './modules/leagues/routes';
import { invitationsModule } from './modules/invitations/routes';
import { contestsModule, contestsByIdModule } from './modules/contests/routes';
import { templatesModule } from './modules/templates/routes';
import { participantsModule } from './modules/participants/routes';

export function buildApp() {
  const app = Fastify({ logger: true });

  // Core plugins
  app.register(healthPlugin);

  // Domain modules
  app.register(leaguesModule, { prefix: '/api/v1/leagues' });
  app.register(invitationsModule, { prefix: '/api/v1/invitations' });
  app.register(contestsModule, { prefix: '/api/v1/leagues/:id/contests' });
  app.register(contestsByIdModule, { prefix: '/api/v1/contests' });
  app.register(templatesModule, { prefix: '/api/v1/templates' });
  app.register(participantsModule, { prefix: '/api/v1/participants' });

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
