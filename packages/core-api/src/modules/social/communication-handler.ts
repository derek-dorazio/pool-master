import type { FastifyReply, FastifyRequest } from 'fastify';
import { SocialCommunicationError, SocialCommunicationService } from './communication-service';

export function createCommunicationHandlers(service: SocialCommunicationService) {
  return {
    getConversations,
    getConversationMessages,
    sendConversationMessage,
    markConversationRead,
    getContestChat,
    sendContestChatMessage,
    getShareCard,
    getRecap,
  };

  function userIdFrom(request: FastifyRequest): string | undefined {
    return request.authUser?.userId ?? (request.headers['x-user-id'] as string | undefined);
  }

  function handleError(reply: FastifyReply, err: unknown): boolean {
    if (err instanceof SocialCommunicationError) {
      reply.status(err.statusCode).send({ error: err.code, message: err.message });
      return true;
    }
    return false;
  }

  async function getConversations(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = userIdFrom(request);
    if (!userId) {
      reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
      return;
    }

    reply.send(service.listConversations(userId));
  }

  async function getConversationMessages(
    request: FastifyRequest<{ Params: { conversationId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = userIdFrom(request);
    if (!userId) {
      reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
      return;
    }

    try {
      reply.send(service.getConversationMessages(userId, request.params.conversationId));
    } catch (err) {
      if (!handleError(reply, err)) throw err;
    }
  }

  async function sendConversationMessage(
    request: FastifyRequest<{ Params: { conversationId: string }; Body: { content: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = userIdFrom(request);
    if (!userId) {
      reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
      return;
    }

    try {
      reply.status(201).send(service.sendDirectMessage(userId, request.params.conversationId, request.body.content));
    } catch (err) {
      if (!handleError(reply, err)) throw err;
    }
  }

  async function markConversationRead(
    request: FastifyRequest<{ Params: { conversationId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = userIdFrom(request);
    if (!userId) {
      reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
      return;
    }

    try {
      reply.send(service.markConversationRead(userId, request.params.conversationId));
    } catch (err) {
      if (!handleError(reply, err)) throw err;
    }
  }

  async function getContestChat(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = userIdFrom(request);
    if (!userId) {
      reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
      return;
    }

    reply.send(service.getContestChat(userId, request.params.contestId));
  }

  async function sendContestChatMessage(
    request: FastifyRequest<{ Params: { contestId: string }; Body: { content: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = userIdFrom(request);
    if (!userId) {
      reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
      return;
    }

    try {
      reply.status(201).send(service.sendContestChatMessage(userId, request.params.contestId, request.body.content));
    } catch (err) {
      if (!handleError(reply, err)) throw err;
    }
  }

  async function getShareCard(
    request: FastifyRequest<{ Params: { shareId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      reply.send(service.getShareCard(request.params.shareId));
    } catch (err) {
      if (!handleError(reply, err)) throw err;
    }
  }

  async function getRecap(
    request: FastifyRequest<{ Params: { leagueId: string }; Querystring: { week?: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const week = request.query.week ?? 'current';
    reply.send(service.getRecap(request.params.leagueId, week));
  }
}
