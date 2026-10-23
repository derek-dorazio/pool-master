/**
 * The root admin's test email (#910), mounted at /api/v1/platform/email:
 *   POST /test — sends one fixed email to one address and says what happened
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EmailTestRequest } from '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/email-test.dto';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
import { toEmailTestResponseDto } from '../../mappers/email-test.mapper';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { requireAuthUser } from '../../plugins/auth-guard';
import type { EmailTestService } from './email-test-service';

export interface EmailTestModuleOptions {
  emailTest: EmailTestService;
}

export function emailTestModule(fastify: FastifyInstance, opts: EmailTestModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);
  fastify.addHook('onRequest', requireRootAdmin);

  fastify.post('/test', {
    schema: {
      tags: ['Platform'],
      summary: 'Send a test email',
      description:
        'Root admin only. Sends one fixed test email to `to` the way every system email goes: it obeys "Send system email" and "Only send to", skips a suppressed address, and goes through the outbox and the configured provider. Waits for the sender\'s first try and returns where the email stands: SENT, SKIPPED with the reason, or QUEUED with the provider\'s error when that try failed and a retry is due.',
      operationId: 'sendTestEmail',
      body: schemaRef('EmailTestRequest'),
      response: {
        200: schemaRef('EmailTestResponse'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    handler: async (request: FastifyRequest<{ Body: EmailTestRequest }>) => {
      return toEmailTestResponseDto(await opts.emailTest.send(request.body.to, requireAuthUser(request).userId));
    },
  });
}
