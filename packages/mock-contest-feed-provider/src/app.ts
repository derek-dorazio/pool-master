import Fastify from 'fastify';
import { mockContestFeedRoutes } from './routes';
import { swaggerPlugin } from './swagger';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(swaggerPlugin);
  app.register(mockContestFeedRoutes);

  return app;
}
