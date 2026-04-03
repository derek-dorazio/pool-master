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
import {
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import {
  FeedResponseSchema,
  FeedPostResponseSchema,
  FeedReactionResponseSchema,
  FeedPinResponseSchema,
} from '@poolmaster/shared/dto/social.dto';

export async function socialModule(fastify: FastifyInstance): Promise<void> {
  const feedService = new FeedService();
  const handlers = createFeedHandlers(feedService);

  // --- Get Feed (paginated, cursor-based) ---
  fastify.get('/leagues/:leagueId/feed', {
    schema: {
      tags: ['Social'],
      summary: 'Get league activity feed',
      operationId: 'getLeagueFeed',
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
      response: { 200: zodToJsonSchema(FeedResponseSchema) },
    },
    handler: handlers.getFeed,
  });

  // --- Create Post ---
  fastify.post('/leagues/:leagueId/feed', {
    schema: {
      tags: ['Social'],
      summary: 'Create a feed post',
      operationId: 'createFeedPost',
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
      response: { 201: zodToJsonSchema(FeedPostResponseSchema) },
    },
    handler: handlers.createPost,
  });

  // --- Get Post with Replies ---
  fastify.get('/leagues/:leagueId/feed/:postId', {
    schema: {
      tags: ['Social'],
      summary: 'Get a single feed post',
      operationId: 'getFeedPost',
      params: {
        type: 'object',
        required: ['leagueId', 'postId'],
        properties: {
          leagueId: { type: 'string', format: 'uuid' },
          postId: { type: 'string', format: 'uuid' },
        },
      },
      response: { 200: zodToJsonSchema(FeedPostResponseSchema) },
    },
    handler: handlers.getPost,
  });

  // --- Create Reply ---
  fastify.post('/leagues/:leagueId/feed/:postId/replies', {
    schema: {
      tags: ['Social'],
      summary: 'Reply to a feed post',
      operationId: 'addFeedReply',
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
      response: { 201: zodToJsonSchema(FeedPostResponseSchema) },
    },
    handler: handlers.createReply,
  });

  // --- Toggle Reaction ---
  fastify.post('/leagues/:leagueId/feed/:postId/reactions', {
    schema: {
      tags: ['Social'],
      summary: 'Add a reaction to a post',
      operationId: 'addFeedReaction',
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
      response: { 200: zodToJsonSchema(FeedReactionResponseSchema) },
    },
    handler: handlers.toggleReaction,
  });

  // --- Pin Post ---
  fastify.post('/leagues/:leagueId/feed/:postId/pin', {
    schema: {
      tags: ['Social'],
      summary: 'Pin a feed post',
      operationId: 'pinFeedPost',
      params: {
        type: 'object',
        required: ['leagueId', 'postId'],
        properties: {
          leagueId: { type: 'string', format: 'uuid' },
          postId: { type: 'string', format: 'uuid' },
        },
      },
      response: { 200: zodToJsonSchema(FeedPinResponseSchema) },
    },
    handler: handlers.pinPost,
  });

  // --- Unpin Post ---
  fastify.delete('/leagues/:leagueId/feed/:postId/pin', {
    schema: {
      tags: ['Social'],
      summary: 'Unpin a feed post',
      operationId: 'unpinFeedPost',
      params: {
        type: 'object',
        required: ['leagueId', 'postId'],
        properties: {
          leagueId: { type: 'string', format: 'uuid' },
          postId: { type: 'string', format: 'uuid' },
        },
      },
      response: { 200: zodToJsonSchema(FeedPinResponseSchema) },
    },
    handler: handlers.unpinPost,
  });

  // --- Delete Post ---
  fastify.delete('/leagues/:leagueId/feed/:postId', {
    schema: {
      tags: ['Social'],
      summary: 'Delete a feed post',
      operationId: 'deleteFeedPost',
      params: {
        type: 'object',
        required: ['leagueId', 'postId'],
        properties: {
          leagueId: { type: 'string', format: 'uuid' },
          postId: { type: 'string', format: 'uuid' },
        },
      },
      response: { 200: zodToJsonSchema(FeedPinResponseSchema) },
    },
    handler: handlers.deletePost,
  });
}
