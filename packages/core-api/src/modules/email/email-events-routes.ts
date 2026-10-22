/**
 * The SNS endpoint for SES delivery events (#844 slice 4, plans/email-delivery-ses.md §8):
 *   POST /ses-events — public; the SNS signature and the topic are its whole authority
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SnsMessage } from '@poolmaster/shared/dto';
// Registers ErrorEnvelope and SuccessResponse, which this module's responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
import '@poolmaster/shared/dto/common.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/email-events.dto';
import { sendError } from '../../core/error-handler';
import type { EmailDeliveryEvents } from './email-delivery-events';
import { isSnsUrl, type SnsMessageVerifier } from './sns-message-verifier';

export interface EmailEventsModuleOptions {
  deliveryEvents: EmailDeliveryEvents;
  verifier: SnsMessageVerifier;
  /** The SNS topic SES publishes this environment's events to; unset where SES events are off. */
  topicArn: string | undefined;
  /** Visits the SubscribeURL of a verified subscription confirmation. */
  confirmSubscription?: (subscribeUrl: string) => Promise<void>;
}

export function emailEventsModule(fastify: FastifyInstance, opts: EmailEventsModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  // SNS posts its JSON as text/plain; within this module, read it as JSON.
  fastify.addContentTypeParser('text/plain', { parseAs: 'string' }, (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const confirmSubscription = opts.confirmSubscription ?? visitSubscribeUrl;

  fastify.post<{ Body: SnsMessage }>('/ses-events', {
    schema: {
      tags: ['Email'],
      summary: 'Receive an SES delivery event from SNS',
      description:
        'Public; called by Amazon SNS, never by the app. The message must come from this environment\'s SES events topic and carry a valid SNS signature from an sns.<region>.amazonaws.com certificate, or the answer is 403 EMAIL_EVENT_UNVERIFIED. A subscription confirmation is confirmed. A notification carries one SES event: a delivery marks the email DELIVERED; a permanent bounce marks it BOUNCED and a complaint COMPLAINED, and both stop the app from emailing that address again; a rejection marks it FAILED. A transient bounce, or an event for an email this environment did not send, changes nothing and still answers 200, so SNS does not retry it.',
      operationId: 'receiveSesEvent',
      body: schemaRef('SnsMessage'),
      response: {
        200: schemaRef('SuccessResponse'),
        400: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
  }, async (request: FastifyRequest<{ Body: SnsMessage }>, reply: FastifyReply) => {
    const logger = request.contextLogger ?? request.log;
    const message = request.body;
    if (!opts.topicArn || message.TopicArn !== opts.topicArn || !(await opts.verifier.verify(message))) {
      logger.warn({
        action: 'email.deliveryEvent.unverified',
        data: { type: message.Type, topicArn: message.TopicArn, configured: Boolean(opts.topicArn) },
      }, 'Refused an SNS message that is not from this environment\'s SES events topic');
      return sendError(reply, 403, 'EMAIL_EVENT_UNVERIFIED', 'This message is not from the SES events topic.');
    }

    switch (message.Type) {
      case 'SubscriptionConfirmation': {
        if (!message.SubscribeURL || !isSnsUrl(message.SubscribeURL)) {
          return sendError(reply, 403, 'EMAIL_EVENT_UNVERIFIED', 'The subscription confirmation has no SNS subscribe URL.');
        }
        await confirmSubscription(message.SubscribeURL);
        logger.info({ action: 'email.deliveryEvent.subscribed', data: { topicArn: message.TopicArn } }, 'Confirmed the SES events subscription');
        break;
      }
      case 'UnsubscribeConfirmation':
        logger.warn({ action: 'email.deliveryEvent.unsubscribed', data: { topicArn: message.TopicArn } }, 'SNS reports the SES events subscription was removed');
        break;
      case 'Notification':
        await opts.deliveryEvents.record(message.Message, logger);
        break;
    }
    return reply.status(200).send({ success: true });
  });
}

async function visitSubscribeUrl(subscribeUrl: string): Promise<void> {
  const response = await fetch(subscribeUrl);
  if (!response.ok) throw new Error(`Confirming the SNS subscription answered ${String(response.status)}`);
}
