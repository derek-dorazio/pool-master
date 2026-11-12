/**
 * Provider webhooks (#1498), mounted at /api/v1/provider-webhooks:
 *   POST /balldontlie — public; the delivery's HMAC signature is its whole authority
 *
 * A delivery only triggers work: it is checked, read, and answered at once, and the syncs it
 * asks for run as background jobs that read the provider's current state over REST. Nothing in
 * the delivery is written anywhere.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BalldontlieWebhookNotification } from '@poolmaster/shared/dto';
// Registers ErrorEnvelope and SuccessResponse, which this module's responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
import '@poolmaster/shared/dto/common.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/provider-webhooks.dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { sendError } from '../../core/error-handler';
import { checkBalldontlieSignature, readBalldontlieNotification } from './adapters/balldontlie/balldontlie-webhooks';
import type { ProviderNotificationService } from './provider-notifications';

export interface ProviderWebhooksModuleOptions {
  notifications: Pick<ProviderNotificationService, 'receive'>;
  /** The BALLDONTLIE endpoint's signing secret; unset, every delivery is refused. */
  balldontlieSigningSecret: string | undefined;
  now?: () => Date;
}

/** A delivery is a small JSON object; anything larger is not one. */
const WEBHOOK_BODY_LIMIT_BYTES = 64 * 1024;

/** The secret a webhook is signed with, from BALLDONTLIE_WEBHOOK_SECRET; undefined when unset or blank. */
export function readBalldontlieWebhookSecret(env: NodeJS.ProcessEnv): string | undefined {
  return env['BALLDONTLIE_WEBHOOK_SECRET']?.trim() || undefined;
}

export function providerWebhooksModule(fastify: FastifyInstance, opts: ProviderWebhooksModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  // The signature covers the body's bytes exactly as posted, so within this module JSON is kept as
  // a raw buffer beside its parsed form.
  const rawBodies = new WeakMap<FastifyRequest, Buffer>();
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    try {
      const raw = body as Buffer;
      rawBodies.set(request, raw);
      done(null, JSON.parse(raw.toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const now = opts.now ?? (() => new Date());

  fastify.post<{ Body: BalldontlieWebhookNotification }>('/balldontlie', {
    bodyLimit: WEBHOOK_BODY_LIMIT_BYTES,
    schema: {
      tags: ['Ingestion'],
      summary: 'Receive a BALLDONTLIE webhook notification',
      description:
        'Public; called by BALLDONTLIE, never by the app. The delivery must carry X-BDL-Webhook-Timestamp (Unix seconds, within 5 minutes of now) and X-BDL-Webhook-Signature (`v1=` and the hex HMAC-SHA256 of `{timestamp}.{body}` under this environment\'s endpoint secret; several, separated by commas or spaces, while the secret rotates, any one of which may match), or the answer is 403 PROVIDER_WEBHOOK_UNVERIFIED, as it is for every delivery while no secret is configured. '
        + 'A verified notification about a game or tournament linked to an in-progress event queues one live-score sync of that event, due about a minute later; notifications arriving while it waits queue nothing more. The sync reads the provider\'s current scores, so the notification\'s own contents are never written. '
        + 'A notification about nothing linked, or of a type PoolMaster does not act on, is acknowledged and dropped. Every verified delivery answers 200, so the provider does not retry it.',
      operationId: 'receiveBalldontlieWebhook',
      body: schemaRef('BalldontlieWebhookNotification'),
      response: {
        200: schemaRef('SuccessResponse'),
        400: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    // Checked before the body's schema, so an unsigned caller learns nothing about its shape.
    preValidation: async (request: FastifyRequest, reply: FastifyReply) => {
      const logger = request.contextLogger ?? request.log;
      const secret = opts.balldontlieSigningSecret;
      const check = secret === undefined
        ? 'NOT_CONFIGURED'
        : checkBalldontlieSignature({
            timestamp: singleHeader(request.headers['x-bdl-webhook-timestamp']),
            signature: singleHeader(request.headers['x-bdl-webhook-signature']),
            rawBody: rawBodies.get(request) ?? Buffer.alloc(0),
          }, secret, now());
      if (check === 'VALID') return;
      logger.warn({
        action: 'ingestion.balldontlieWebhook.unverified',
        data: { reason: check, deliveryId: singleHeader(request.headers['x-bdl-webhook-id']) ?? null },
      }, 'Refused a BALLDONTLIE webhook delivery without a valid, current signature');
      return sendError(reply, 403, 'PROVIDER_WEBHOOK_UNVERIFIED', 'This delivery is not signed with the BALLDONTLIE endpoint secret.');
    },
  }, async (request: FastifyRequest<{ Body: BalldontlieWebhookNotification }>, reply: FastifyReply) => {
    const logger = request.contextLogger ?? request.log;
    const deliveryId = singleHeader(request.headers['x-bdl-webhook-id']) ?? null;
    const notification = readBalldontlieNotification(request.body);
    if (!notification) {
      logger.info({
        action: 'ingestion.balldontlieWebhook.ignored',
        data: { deliveryId, notificationType: request.body.event_type ?? null },
      }, 'Acknowledged a BALLDONTLIE notification PoolMaster does not act on');
      return reply.status(200).send({ success: true });
    }
    const outcome = await opts.notifications.receive(notification);
    logger.info({
      action: 'ingestion.balldontlieWebhook.received',
      data: { deliveryId, notificationType: notification.notificationType, ...outcome },
    }, 'Received a BALLDONTLIE notification');
    return reply.status(200).send({ success: true });
  });
}

/** A header sent once; a repeated header is not a value this route reads. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
