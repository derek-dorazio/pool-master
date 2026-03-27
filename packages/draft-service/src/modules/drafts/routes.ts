/**
 * Draft module — REST routes for async snake draft and selection templates.
 *
 * In async mode, picks are submitted via HTTP POST.
 * The timer runs server-side; auto-pick triggers if the deadline passes.
 */

import type { FastifyInstance } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import {
  SELECTION_TEMPLATES,
  getTemplatesForSport,
  getTemplatesForContestType,
  getTemplateById,
} from '../../templates/selection-templates';

export async function draftsModule(fastify: FastifyInstance): Promise<void> {
  /** Get the current draft state for a contest. */
  fastify.get('/:contestId', {
    schema: {
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
    },
    handler: async (request) => {
      const { contestId } = request.params as { contestId: string };
      // TODO: Load draft session + state from DB
      return { contestId, message: 'not implemented' };
    },
  });

  /** Start a draft session. Commissioner only. */
  fastify.post('/:contestId/start', {
    schema: {
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      // TODO: Load session, call startSession(), persist, return state
      return reply.status(501).send({ contestId, message: 'not implemented' });
    },
  });

  /** Submit a pick (async mode). */
  fastify.post('/:contestId/pick', {
    schema: {
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['entryId', 'participantId'],
        properties: {
          entryId: { type: 'string', format: 'uuid' },
          participantId: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      const { entryId, participantId } = request.body as {
        entryId: string;
        participantId: string;
      };
      // TODO: Load state, validate pick, apply, persist, check timer
      return reply.status(501).send({ contestId, entryId, participantId, message: 'not implemented' });
    },
  });

  /** Pause the draft. Commissioner only. */
  fastify.post('/:contestId/pause', {
    schema: {
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      return reply.status(501).send({ contestId, message: 'not implemented' });
    },
  });

  /** Resume the draft. Commissioner only. */
  fastify.post('/:contestId/resume', {
    schema: {
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      return reply.status(501).send({ contestId, message: 'not implemented' });
    },
  });

  /** Extend the current pick deadline. Commissioner only. */
  fastify.post('/:contestId/extend', {
    schema: {
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['additionalSeconds'],
        properties: {
          additionalSeconds: { type: 'number', minimum: 1, maximum: 3600 },
        },
      },
    },
    handler: async (request, reply) => {
      const { contestId } = request.params as { contestId: string };
      return reply.status(501).send({ contestId, message: 'not implemented' });
    },
  });

  // --- Selection Template Routes ---

  /** List all selection templates, optionally filtered by sport and/or contestType. */
  fastify.get('/templates', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          sport: { type: 'string' },
          contestType: { type: 'string' },
        },
      },
    },
    handler: async (request) => {
      const { sport, contestType } = request.query as {
        sport?: string;
        contestType?: string;
      };

      if (sport && contestType) {
        return getTemplatesForContestType(sport as Sport, contestType);
      }
      if (sport) {
        return getTemplatesForSport(sport as Sport);
      }
      return SELECTION_TEMPLATES;
    },
  });

  /** Get a single selection template by ID. */
  fastify.get('/templates/:templateId', {
    schema: {
      params: {
        type: 'object',
        required: ['templateId'],
        properties: { templateId: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { templateId } = request.params as { templateId: string };
      const template = getTemplateById(templateId);
      if (!template) {
        return reply.status(404).send({ error: `Template ${templateId} not found` });
      }
      return template;
    },
  });
}
