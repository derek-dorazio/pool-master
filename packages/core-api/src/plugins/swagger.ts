/**
 * Swagger / OpenAPI 3.2 plugin for Fastify.
 *
 * Registers @fastify/swagger to auto-generate an OpenAPI spec from route schemas,
 * and @fastify/swagger-ui to serve interactive docs at /apidoc.
 */
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export const swaggerPlugin = fp(async (fastify) => {
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0', // @fastify/swagger uses 3.1.0; compatible with 3.2 patterns
      info: {
        title: 'PoolMaster API',
        description: 'Contest pool management platform — leagues, contests, drafts, scoring, and admin tools.',
        version: '1.0.0',
        contact: {
          name: 'PoolMaster Team',
        },
      },
      servers: [
        { url: '/', description: 'Current server' },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT access token from /api/v1/auth/login or /api/v1/auth/register',
          },
        },
      },
      security: [{ BearerAuth: [] }],
      tags: [
        { name: 'Auth', description: 'Authentication, registration, and user profile' },
        { name: 'Leagues', description: 'League CRUD, membership, and lifecycle management' },
        { name: 'Contests', description: 'Contest creation, lifecycle, and scoring' },
        { name: 'Drafts', description: 'Draft sessions — snake, auction, tiered' },
        { name: 'Standings', description: 'Contest standings and leaderboards' },
        { name: 'Participants', description: 'Participant profiles and contest pools' },
        { name: 'Invitations', description: 'League invitations and invite links' },
        { name: 'Notifications', description: 'User notifications and preferences' },
        { name: 'Social', description: 'Feed, chat, and sharing' },
        { name: 'Admin', description: 'Platform administration' },
        { name: 'Config', description: 'Platform and sports configuration' },
        { name: 'History', description: 'League history, records, and analytics' },
        { name: 'Health', description: 'Service health checks' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/apidoc',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      defaultModelsExpandDepth: 2,
    },
  });
});
