import type { FastifyInstance } from 'fastify';
import { FeedService } from './feed-service';
import { createFeedHandlers } from './feed-handler';
import { SocialCommunicationService } from './communication-service';
import { createCommunicationHandlers } from './communication-handler';
import {
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import {
  ChatMessageDtoSchema,
  ConversationDtoSchema,
  DirectMessageDtoSchema,
  FeedResponseSchema,
  FeedReactionResponseSchema,
  FeedPinResponseSchema,
  RecapDtoSchema,
  ShareCardDtoSchema,
} from '@poolmaster/shared/dto/social.dto';
import { ApiErrorSchema, SuccessSchema } from '@poolmaster/shared/dto/common.dto';

const feedItemResponseJsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    leagueId: { type: 'string' },
    authorId: { type: 'string' },
    type: { type: 'string' },
    authorName: { type: 'string' },
    content: { type: 'string' },
    isPinned: { type: 'boolean' },
    reactions: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    replyCount: { type: 'number' },
    parentId: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'leagueId',
    'authorId',
    'type',
    'authorName',
    'content',
    'isPinned',
    'reactions',
    'replyCount',
    'createdAt',
    'updatedAt',
  ],
  additionalProperties: false,
} as const;

const feedPostResponseJsonSchema = {
  ...feedItemResponseJsonSchema,
  properties: {
    ...feedItemResponseJsonSchema.properties,
    replies: {
      type: 'array',
      items: feedItemResponseJsonSchema,
    },
  },
} as const;

export async function socialModule(fastify: FastifyInstance): Promise<void> {
  const feedService = new FeedService();
  const handlers = createFeedHandlers(feedService);
  const communicationService = new SocialCommunicationService();
  const communicationHandlers = createCommunicationHandlers(communicationService);

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
      response: { 201: feedPostResponseJsonSchema },
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
      response: { 200: feedPostResponseJsonSchema },
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
      response: { 201: feedPostResponseJsonSchema },
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

  fastify.get('/social/messages/conversations', {
    schema: {
      tags: ['Social'],
      summary: 'List direct message conversations',
      operationId: 'listSocialConversations',
      response: {
        200: zodToJsonSchema(ConversationDtoSchema.array()),
        401: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: communicationHandlers.getConversations,
  });

  fastify.get('/social/messages/conversations/:conversationId', {
    schema: {
      tags: ['Social'],
      summary: 'Get messages in a direct message conversation',
      operationId: 'getSocialConversationMessages',
      params: {
        type: 'object',
        required: ['conversationId'],
        properties: { conversationId: { type: 'string' } },
      },
      response: {
        200: zodToJsonSchema(DirectMessageDtoSchema.array()),
        401: zodToJsonSchema(ApiErrorSchema),
        404: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: communicationHandlers.getConversationMessages,
  });

  fastify.post('/social/messages/conversations/:conversationId', {
    schema: {
      tags: ['Social'],
      summary: 'Send a direct message',
      operationId: 'sendSocialConversationMessage',
      params: {
        type: 'object',
        required: ['conversationId'],
        properties: { conversationId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['content'],
        properties: { content: { type: 'string', minLength: 1, maxLength: 500 } },
      },
      response: {
        201: zodToJsonSchema(DirectMessageDtoSchema),
        401: zodToJsonSchema(ApiErrorSchema),
        404: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: communicationHandlers.sendConversationMessage,
  });

  fastify.patch('/social/messages/conversations/:conversationId/read', {
    schema: {
      tags: ['Social'],
      summary: 'Mark a direct message conversation as read',
      operationId: 'markSocialConversationRead',
      params: {
        type: 'object',
        required: ['conversationId'],
        properties: { conversationId: { type: 'string' } },
      },
      response: {
        200: zodToJsonSchema(SuccessSchema),
        401: zodToJsonSchema(ApiErrorSchema),
        404: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: communicationHandlers.markConversationRead,
  });

  fastify.get('/social/contests/:contestId/chat', {
    schema: {
      tags: ['Social'],
      summary: 'Get contest chat messages',
      operationId: 'getContestChat',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string' } },
      },
      response: {
        200: zodToJsonSchema(ChatMessageDtoSchema.array()),
        401: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: communicationHandlers.getContestChat,
  });

  fastify.post('/social/contests/:contestId/chat', {
    schema: {
      tags: ['Social'],
      summary: 'Send a contest chat message',
      operationId: 'sendContestChatMessage',
      params: {
        type: 'object',
        required: ['contestId'],
        properties: { contestId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['content'],
        properties: { content: { type: 'string', minLength: 1, maxLength: 500 } },
      },
      response: {
        201: zodToJsonSchema(ChatMessageDtoSchema),
        401: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: communicationHandlers.sendContestChatMessage,
  });

  fastify.get('/social/shares/:shareId', {
    schema: {
      tags: ['Social'],
      summary: 'Get share card details',
      operationId: 'getShareCard',
      params: {
        type: 'object',
        required: ['shareId'],
        properties: { shareId: { type: 'string' } },
      },
      response: {
        200: zodToJsonSchema(ShareCardDtoSchema),
        404: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: communicationHandlers.getShareCard,
  });

  fastify.get('/social/leagues/:leagueId/recap', {
    schema: {
      tags: ['Social'],
      summary: 'Get league recap',
      operationId: 'getLeagueRecap',
      params: {
        type: 'object',
        required: ['leagueId'],
        properties: { leagueId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: { week: { type: 'string' } },
      },
      response: {
        200: zodToJsonSchema(RecapDtoSchema),
        404: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: communicationHandlers.getRecap,
  });
}
