import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export const swaggerPlugin = fp(async (fastify) => {
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Mock Contest Feed Provider',
        description: 'QA/local-only contest feed simulator for odds, rankings, and results.',
        version: '0.1.0',
      },
      servers: [{ url: '/', description: 'Current server' }],
      tags: [
        { name: 'Health', description: 'Health checks' },
        { name: 'Scenarios', description: 'Scenario catalog and event listings' },
        { name: 'Feeds', description: 'Odds, rankings, results, and update snapshots' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
});
