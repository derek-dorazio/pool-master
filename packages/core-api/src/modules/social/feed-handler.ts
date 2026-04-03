/**
 * Feed route handlers — create, read, reply, react, pin, delete.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FeedService } from './feed-service';
import { FeedError } from './feed-service';
import {
  mapFeedPageToDto,
  mapFeedPostToDto,
} from '../../mappers';

export function createFeedHandlers(feedService: FeedService) {
  return {
    getFeed,
    createPost,
    getPost,
    createReply,
    toggleReaction,
    pinPost,
    unpinPost,
    deletePost,
  };

  async function getFeed(
    request: FastifyRequest<{
      Params: { leagueId: string };
      Querystring: { cursor?: string; limit?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { leagueId } = request.params;
    const query = request.query as { cursor?: string; limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 20;

    try {
      const result = await feedService.getFeed(leagueId, query.cursor, limit);
      return reply.send(mapFeedPageToDto(result));
    } catch (err) {
      if (err instanceof FeedError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }

  async function createPost(
    request: FastifyRequest<{
      Params: { leagueId: string };
      Body: { content: string; type?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { leagueId } = request.params;
    const { content, type } = request.body as { content: string; type?: string };

    const userId = (request.authUser?.userId
      ?? request.headers['x-user-id']) as string | undefined;

    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
    }

    if (!content || content.trim().length === 0) {
      return reply.status(400).send({ error: 'INVALID_CONTENT', message: 'Content is required' });
    }

    try {
      const postType = (type as 'POST' | 'ANNOUNCEMENT' | 'SYSTEM') ?? 'POST';
      const post = await feedService.createPost(leagueId, userId, content, postType);
      return reply.status(201).send(mapFeedPostToDto(post));
    } catch (err) {
      if (err instanceof FeedError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }

  async function getPost(
    request: FastifyRequest<{
      Params: { leagueId: string; postId: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { postId } = request.params;

    try {
      const post = await feedService.getPost(postId);
      return reply.send(mapFeedPostToDto(post));
    } catch (err) {
      if (err instanceof FeedError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }

  async function createReply(
    request: FastifyRequest<{
      Params: { leagueId: string; postId: string };
      Body: { content: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { postId } = request.params;
    const { content } = request.body as { content: string };

    const userId = (request.authUser?.userId
      ?? request.headers['x-user-id']) as string | undefined;

    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
    }

    if (!content || content.trim().length === 0) {
      return reply.status(400).send({ error: 'INVALID_CONTENT', message: 'Content is required' });
    }

    try {
      const replyPost = await feedService.createReply(postId, userId, content);
      return reply.status(201).send(mapFeedPostToDto(replyPost));
    } catch (err) {
      if (err instanceof FeedError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }

  async function toggleReaction(
    request: FastifyRequest<{
      Params: { leagueId: string; postId: string };
      Body: { emoji: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { postId } = request.params;
    const { emoji } = request.body as { emoji: string };

    const userId = (request.authUser?.userId
      ?? request.headers['x-user-id']) as string | undefined;

    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
    }

    if (!emoji || emoji.trim().length === 0) {
      return reply.status(400).send({ error: 'INVALID_EMOJI', message: 'Emoji is required' });
    }

    try {
      const result = await feedService.toggleReaction(postId, userId, emoji);
      return reply.send(result);
    } catch (err) {
      if (err instanceof FeedError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }

  async function pinPost(
    request: FastifyRequest<{
      Params: { leagueId: string; postId: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { postId } = request.params;

    try {
      await feedService.pinPost(postId);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof FeedError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }

  async function unpinPost(
    request: FastifyRequest<{
      Params: { leagueId: string; postId: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { postId } = request.params;

    try {
      await feedService.unpinPost(postId);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof FeedError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }

  async function deletePost(
    request: FastifyRequest<{
      Params: { leagueId: string; postId: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { postId } = request.params;

    try {
      await feedService.deletePost(postId);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof FeedError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }
}
