import type { FastifyInstance } from 'fastify';
import {
  AccountDeleteRequestSchema,
  AccountDeleteResponseSchema,
  AccountResponseSchema,
  ErrorEnvelopeSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { getAppPrisma } from '../../core/prisma-context';
import { createAccountHandlers } from './handler';
import { AccountService } from './service';

export async function accountModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
  const service = new AccountService(prisma);
  const handlers = createAccountHandlers(service);

  fastify.post('/inactivate', {
    schema: {
      tags: ['Account'],
      summary: 'Inactivate the authenticated account',
      description:
        'Marks the authenticated account inactive for normal sign-in and product usage. This is the required first step before a permanent self-delete becomes available.',
      operationId: 'inactivateAccount',
      response: {
        200: zodToJsonSchema(AccountResponseSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
        409: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.inactivate,
  });

  fastify.delete('/', {
    schema: {
      tags: ['Account'],
      summary: 'Delete the authenticated inactive account permanently',
      description:
        'Permanently deletes the authenticated account after the user has already inactivated it and provides exact email confirmation. This removes the user row and user-owned account data.',
      operationId: 'deleteAccount',
      body: zodToJsonSchema(AccountDeleteRequestSchema),
      response: {
        200: zodToJsonSchema(AccountDeleteResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
        409: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.deleteAccount,
  });
}
