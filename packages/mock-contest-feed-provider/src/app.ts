import Fastify from 'fastify';
import { mockContestFeedRoutes } from './routes';
import { swaggerPlugin } from './swagger';

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      base: {
        service: 'mock-contest-feed-provider',
        env: process.env.NODE_ENV ?? 'development',
      },
      formatters: {
        level(label) {
          return { level: label.toUpperCase() };
        },
      },
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    },
  });

  app.register(swaggerPlugin);
  app.register(mockContestFeedRoutes);

  return app;
}
