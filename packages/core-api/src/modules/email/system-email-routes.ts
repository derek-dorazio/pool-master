/**
 * The root admin's Notifications page (#1870), mounted at /api/v1/platform/emails:
 *   GET  /                                  — every system email with its sends of the last 30 days
 *   GET  /:templateKey/latest-send          — the latest send that still keeps its content
 *   POST /:templateKey/latest-send/send-to-me — a copy of that send to the calling admin
 * An email's On/Off status is changed with the EMAIL_CONFIG settings update.
 */

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  ApiErrorCode,
  SystemEmailLatestSendResponse,
  SystemEmailListResponse,
  SystemEmailResendResponse,
} from '@poolmaster/shared/dto';
import { EmailTemplateKey } from '@poolmaster/shared/domain';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/system-emails.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { requireAuthUser } from '../../plugins/auth-guard';
import { toSystemEmailDto, toSystemEmailLatestSendDto, toSystemEmailResendDto } from '../../mappers';
import type { SystemEmailAdminService } from './system-email-admin-service';
import type { SystemEmailTemplateKey } from './system-email-templates';

/**
 * Requests one address may make a minute on each Notifications route. The page makes a handful;
 * a script hammering a route does not stay inside it. Per process, as the other per-address limits.
 */
export const SYSTEM_EMAIL_REQUESTS_PER_MINUTE = 60;

/** An address over its requests for the minute on a Notifications route. */
export class SystemEmailRateLimitError extends Error {
  readonly statusCode = 429;
  readonly code: ApiErrorCode = 'SYSTEM_EMAIL_RATE_LIMITED';

  constructor() {
    super('Too many requests for system emails from this address; try again in a minute.');
    this.name = 'SystemEmailRateLimitError';
  }
}

const RATE_LIMITED = ` More than ${SYSTEM_EMAIL_REQUESTS_PER_MINUTE} requests a minute from one address answer 429 SYSTEM_EMAIL_RATE_LIMITED.`;
const RATE_LIMIT_CONFIG = { rateLimit: { max: SYSTEM_EMAIL_REQUESTS_PER_MINUTE, timeWindow: 60_000 } };
const NOT_SENT = ' 404 SYSTEM_EMAIL_NOT_SENT when no send of the email in the last 30 days still keeps its content: never sent, '
  + 'content cleared 7 days after sending, or an email that carries a secret (a password reset) and keeps none.';

const TEMPLATE_PARAMS = {
  type: 'object',
  required: ['templateKey'],
  properties: { templateKey: { type: 'string', enum: Object.values(EmailTemplateKey) } },
};

type TemplateParams = { Params: { templateKey: SystemEmailTemplateKey } };

function errors(...statuses: number[]) {
  const envelope = schemaRef('ErrorEnvelope');
  return Object.fromEntries([...statuses, 429].map((status) => [status, envelope]));
}

export interface SystemEmailModuleOptions {
  systemEmails: SystemEmailAdminService;
}

export async function systemEmailModule(fastify: FastifyInstance, opts: SystemEmailModuleOptions): Promise<void> {
  void fastify.register(schemaComponentsPlugin);
  // Awaited, so its route hook is in place before the module's routes are declared.
  await fastify.register(rateLimit, { global: false, errorResponseBuilder: () => new SystemEmailRateLimitError() });
  fastify.addHook('onRequest', requireRootAdmin);
  const tags = ['Platform'];
  const { systemEmails } = opts;

  fastify.get('/', {
    schema: {
      tags,
      summary: 'List the system emails',
      description: 'Every system email, one per template key, with its plan feature, its On/Off status, how many were sent in the last 30 days, '
        + 'and when the last send and the newest send a preview can show went. Root admin only.' + RATE_LIMITED,
      operationId: 'listSystemEmails',
      response: { 200: schemaRef('SystemEmailListResponse'), ...errors(401, 403) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (): Promise<SystemEmailListResponse> => ({
      emails: (await systemEmails.list()).map(toSystemEmailDto),
    }),
  });

  fastify.get('/:templateKey/latest-send', {
    schema: {
      tags,
      summary: 'Get a system email\'s latest send',
      description: 'The newest send of the email whose subject and HTML the outbox still keeps, exactly as it went, with its recipient masked. '
        + 'Root admin only.' + NOT_SENT + RATE_LIMITED,
      operationId: 'getSystemEmailLatestSend',
      params: TEMPLATE_PARAMS,
      response: { 200: schemaRef('SystemEmailLatestSendResponse'), ...errors(400, 401, 403, 404) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<TemplateParams>): Promise<SystemEmailLatestSendResponse> => (
      toSystemEmailLatestSendDto(await systemEmails.latestSend(request.params.templateKey))
    ),
  });

  fastify.post('/:templateKey/latest-send/send-to-me', {
    schema: {
      tags,
      summary: 'Send me a system email\'s latest send',
      description: 'Queues a copy of the latest send (same sender, subject and HTML) to the calling root admin\'s own address through the outbox, '
        + 'a new email each press. It obeys "Send system email", the email\'s own switch, "Only send to" and the suppression list, '
        + 'and answers QUEUED or SKIPPED with the reason. Root admin only.' + NOT_SENT + RATE_LIMITED,
      operationId: 'sendSystemEmailLatestSendToMe',
      params: TEMPLATE_PARAMS,
      response: { 200: schemaRef('SystemEmailResendResponse'), ...errors(400, 401, 403, 404) },
    },
    config: RATE_LIMIT_CONFIG,
    handler: async (request: FastifyRequest<TemplateParams>): Promise<SystemEmailResendResponse> => (
      toSystemEmailResendDto(await systemEmails.sendLatestTo(request.params.templateKey, requireAuthUser(request).userId))
    ),
  });
}
