import Fastify from 'fastify';
import { mockContestFeedRoutes, type MockContestFeedRouteOptions } from './routes';
import { swaggerPlugin } from './swagger';

export interface MockContestFeedAppOptions {
  readonly routes?: MockContestFeedRouteOptions;
}

export function buildApp(options: MockContestFeedAppOptions = {}) {
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
  app.register(mockContestFeedRoutes, options.routes ?? {});

  return app;
}
