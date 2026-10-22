/**
 * What SES reports after it accepts an email (#844 slice 4, plans/email-delivery-ses.md §8): it
 * reached the mail server, bounced, was marked as spam, or was rejected. SES publishes each report
 * from the configuration set to an SNS topic, and SNS posts it to core-api. Each report updates
 * the email's row in the outbox; a permanent bounce or a complaint also puts the address on the
 * suppression list, so the app stops emailing it and can say why.
 */

import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { EmailMessageRepository, EmailSuppressionRepository } from '@poolmaster/shared/db';
import {
  EmailMessageStatus,
  EmailSuppressionReason,
  type DeliveryOutcomeStatus,
} from '@poolmaster/shared/domain';

const RecipientsSchema = z.array(z.object({ emailAddress: z.string() }));

/**
 * The SES event fields core-api reads; SES sends many more. Configuration-set events name their
 * kind in `eventType`. https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html
 */
const SesEventSchema = z.discriminatedUnion('eventType', [
  z.object({ eventType: z.literal('Delivery'), mail: z.object({ messageId: z.string() }) }),
  z.object({
    eventType: z.literal('Bounce'),
    mail: z.object({ messageId: z.string() }),
    bounce: z.object({
      bounceType: z.string().describe('Permanent, Transient or Undetermined.'),
      bounceSubType: z.string().optional(),
      bouncedRecipients: RecipientsSchema,
    }),
  }),
  z.object({
    eventType: z.literal('Complaint'),
    mail: z.object({ messageId: z.string() }),
    complaint: z.object({ complainedRecipients: RecipientsSchema }),
  }),
  z.object({
    eventType: z.literal('Reject'),
    mail: z.object({ messageId: z.string() }),
    reject: z.object({ reason: z.string() }).optional(),
  }),
]);
type SesEvent = z.infer<typeof SesEventSchema>;

/** SES's own bounce type for a mailbox that will never accept mail. */
const PERMANENT_BOUNCE = 'Permanent';

export interface EmailDeliveryEventsOptions {
  messages: Pick<EmailMessageRepository, 'recordDeliveryOutcome'>;
  suppressions: Pick<EmailSuppressionRepository, 'suppress'>;
  logger?: FastifyBaseLogger;
}

export class EmailDeliveryEvents {
  constructor(private readonly options: EmailDeliveryEventsOptions) {}

  /**
   * Records one SES event, given as the JSON SNS carried. An event of a kind core-api doesn't
   * subscribe to, or one it can't read, is logged and dropped: SNS would only retry it.
   */
  async record(eventJson: string, logger: FastifyBaseLogger | undefined = this.options.logger): Promise<void> {
    const event = parseSesEvent(eventJson);
    if (!event) {
      logger?.warn({ action: 'email.deliveryEvent.unreadable' }, 'Dropped an SES event core-api cannot read');
      return;
    }
    const providerMessageId = event.mail.messageId;
    if (event.eventType === 'Bounce' && event.bounce.bounceType !== PERMANENT_BOUNCE) {
      // SES retries a transient bounce itself; only the final outcome changes the email.
      logger?.info({
        action: 'email.deliveryEvent.transientBounce',
        data: { providerMessageId, bounceType: event.bounce.bounceType, bounceSubType: event.bounce.bounceSubType ?? null },
      }, 'SES reported a bounce that may not be final');
      return;
    }

    const outcome = outcomeOf(event);
    const message = await this.options.messages.recordDeliveryOutcome(providerMessageId, outcome);
    logger?.info({
      action: 'email.deliveryEvent.recorded',
      data: {
        providerMessageId,
        eventType: event.eventType,
        emailMessageId: message?.id ?? null,
        templateKey: message?.templateKey ?? null,
        status: message?.status ?? null,
      },
    }, message ? 'Recorded an SES delivery event' : 'SES delivery event for an email this outbox did not send');

    const suppressionReason = SUPPRESSION_REASONS[event.eventType];
    if (suppressionReason) {
      for (const email of reportedAddresses(event)) {
        await this.options.suppressions.suppress({ email, suppressionReason, emailMessageId: message?.id });
      }
      logger?.warn({
        action: 'email.deliveryEvent.suppressed',
        data: { providerMessageId, suppressionReason, emailMessageId: message?.id ?? null },
      }, 'Address will not be emailed again');
    }
  }
}

function outcomeOf(event: SesEvent): { status: DeliveryOutcomeStatus; error?: string } {
  switch (event.eventType) {
    case 'Delivery':
      return { status: EmailMessageStatus.DELIVERED };
    case 'Bounce': {
      const subType = event.bounce.bounceSubType ? ` (${event.bounce.bounceSubType})` : '';
      return { status: EmailMessageStatus.BOUNCED, error: `Bounced: ${event.bounce.bounceType}${subType}` };
    }
    case 'Complaint':
      return { status: EmailMessageStatus.COMPLAINED };
    case 'Reject':
      return { status: EmailMessageStatus.FAILED, error: `Rejected by SES: ${event.reject?.reason ?? 'no reason given'}` };
  }
}

const SUPPRESSION_REASONS: Record<SesEvent['eventType'], EmailSuppressionReason | undefined> = {
  Delivery: undefined,
  Bounce: EmailSuppressionReason.BOUNCE,
  Complaint: EmailSuppressionReason.COMPLAINT,
  Reject: undefined,
};

function reportedAddresses(event: SesEvent): string[] {
  if (event.eventType === 'Bounce') return event.bounce.bouncedRecipients.map((recipient) => recipient.emailAddress);
  if (event.eventType === 'Complaint') return event.complaint.complainedRecipients.map((recipient) => recipient.emailAddress);
  return [];
}

function parseSesEvent(eventJson: string): SesEvent | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(eventJson);
  } catch {
    return undefined;
  }
  const parsed = SesEventSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
