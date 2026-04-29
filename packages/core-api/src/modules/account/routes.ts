import type { FastifyInstance } from 'fastify';
import {
  AccountPasswordChangeRequestSchema,
  AccountPasswordChangeResponseSchema,
  AccountPreferencesUpdateRequestSchema,
  AccountProfileUpdateRequestSchema,
  AccountUsernameUpdateRequestSchema,
  AccountDeleteRequestSchema,
  AccountDeleteResponseSchema,
  AccountResponseSchema,
  ErrorEnvelopeSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { getAppPrisma } from '../../core/prisma-context';
import { createAccountHandlers } from './handler';
import { AccountService } from './service';
import { AuthService } from '../auth/auth-service';

export async function accountModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
  const service = new AccountService(prisma, fastify.log);
  const authService = new AuthService(prisma, fastify.log);
  const handlers = createAccountHandlers(service, authService);

  fastify.post('/reactivate', {
    schema: {
      tags: ['Account'],
      summary: 'Reactivate the authenticated account',
      description:
        'Reactivates an inactive account and rotates a fresh browser session so the user can resume normal product usage immediately.',
      operationId: 'reactivateAccount',
      response: {
        200: zodToJsonSchema(AccountResponseSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
        409: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.reactivate,
  });

  fastify.put('/profile', {
    schema: {
      tags: ['Account'],
      summary: 'Update the authenticated account profile',
      description:
        'Updates the authenticated account profile fields that are owned directly by the user profile: email, first name, and last name. Email must remain unique across account emails and usernames.',
      operationId: 'updateAccountProfile',
      body: zodToJsonSchema(AccountProfileUpdateRequestSchema),
      response: {
        200: zodToJsonSchema(AccountResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
        409: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.updateProfile,
  });

  fastify.put('/username', {
    schema: {
      tags: ['Account'],
      summary: 'Update the authenticated account username',
      description:
        'Updates the authenticated account login username after confirming it is unique across account usernames and emails.',
      operationId: 'updateAccountUsername',
      body: zodToJsonSchema(AccountUsernameUpdateRequestSchema),
      response: {
        200: zodToJsonSchema(AccountResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
        409: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.updateUsername,
  });

  fastify.put('/preferences', {
    schema: {
      tags: ['Account'],
      summary: 'Update authenticated account preferences',
      description:
        'Updates first-pass user preferences for locale, timezone, and date/time formatting without inventing a separate preferences-only account model.',
      operationId: 'updateAccountPreferences',
      body: zodToJsonSchema(AccountPreferencesUpdateRequestSchema),
      response: {
        200: zodToJsonSchema(AccountResponseSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
        409: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.updatePreferences,
  });

  fastify.post('/password', {
    schema: {
      tags: ['Account'],
      summary: 'Change the authenticated account password',
      description:
        'Changes the authenticated account password after validating the current password and matching new-password confirmation. Other refresh-token sessions are revoked while the current session stays usable.',
      operationId: 'changeAccountPassword',
      body: zodToJsonSchema(AccountPasswordChangeRequestSchema),
      response: {
        200: zodToJsonSchema(AccountPasswordChangeResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        404: zodToJsonSchema(ErrorEnvelopeSchema),
        409: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.changePassword,
  });

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
