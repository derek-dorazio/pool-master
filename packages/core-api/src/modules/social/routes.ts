/**
 * Social module — registers league activity feed routes.
 *
 * Routes:
 *   GET    /leagues/:leagueId/feed                    — Get feed (cursor, limit)
 *   POST   /leagues/:leagueId/feed                    — Create post
 *   GET    /leagues/:leagueId/feed/:postId            — Get post with replies
 *   POST   /leagues/:leagueId/feed/:postId/replies    — Create reply
 *   POST   /leagues/:leagueId/feed/:postId/reactions  — Toggle reaction
 *   POST   /leagues/:leagueId/feed/:postId/pin        — Pin post
 *   DELETE /leagues/:leagueId/feed/:postId/pin        — Unpin post
 *   DELETE /leagues/:leagueId/feed/:postId            — Delete post
 */

import type { FastifyInstance } from 'fastify';
import { FeedService } from './feed-service';
import { createFeedHandlers } from './feed-handler';

export async function socialModule(fastify: FastifyInstance): Promise<void> {
  const feedService = new FeedService();
  const handlers = createFeedHandlers(feedService);

  // --- Get Feed (paginated, cursor-based) ---
  fastify.get('/leagues/:leagueId/feed', {
    schema: {
      params: {
        type: 'object',
        required: ['leagueId'],
        properties: { leagueId: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: {
          cursor: { type: 'string' },
          limit: { type: 'string' },
        },
      },
    },
    handler: handlers.getFeed,
  });

  // --- Create Post ---
  fastify.post('/leagues/:leagueId/feed', {
    schema: {
      params: {
        type: 'object',
        required: ['leagueId'],
        properties: { leagueId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 5000 },
          type: { type: 'string', enum: ['POST', 'ANNOUNCEMENT', 'SYSTEM'] },
        },
      },
    },
    handler: handlers.createPost,
  });

  // --- Get Post with Replies ---
  fastify.get('/leagues/:leagueId/feed/:postId', {
    schema: {
      params: {
        type: 'object',
        required: ['leagueId', 'postId'],
        properties: {
          leagueId: { type: 'string', format: 'uuid' },
          postId: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: handlers.getPost,
  });

  // --- Create Reply ---
  fastify.post('/leagues/:leagueId/feed/:postId/replies', {
    schema: {
      params: {
        type: 'object',
        required: ['leagueId', 'postId'],
        properties: {
          leagueId: { type: 'string', format: 'uuid' },
          postId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 5000 },
        },
      },
    },
    handler: handlers.createReply,
  });

  // --- Toggle Reaction ---
  fastify.post('/leagues/:leagueId/feed/:postId/reactions', {
    schema: {
      params: {
        type: 'object',
        required: ['leagueId', 'postId'],
        properties: {
          leagueId: { type: 'string', format: 'uuid' },
          postId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['emoji'],
        properties: {
          emoji: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: handlers.toggleReaction,
  });

  // --- Pin Post ---
  fastify.post('/leagues/:leagueId/feed/:postId/pin', {
    schema: {
      params: {
        type: 'object',
        required: ['leagueId', 'postId'],
        properties: {
          leagueId: { type: 'string', format: 'uuid' },
          postId: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: handlers.pinPost,
  });

  // --- Unpin Post ---
  fastify.delete('/leagues/:leagueId/feed/:postId/pin', {
    schema: {
      params: {
        type: 'object',
        required: ['leagueId', 'postId'],
        properties: {
          leagueId: { type: 'string', format: 'uuid' },
          postId: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: handlers.unpinPost,
  });

  // --- Delete Post ---
  fastify.delete('/leagues/:leagueId/feed/:postId', {
    schema: {
      params: {
        type: 'object',
        required: ['leagueId', 'postId'],
        properties: {
          leagueId: { type: 'string', format: 'uuid' },
          postId: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: handlers.deletePost,
  });
}
