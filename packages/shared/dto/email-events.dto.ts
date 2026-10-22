/**
 * Email delivery event DTOs (#844 slice 4): the SNS message AWS posts to core-api for each SES
 * delivery report, and for the subscription handshake.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';

export const SnsMessageTypeSchema = z
  .enum(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'])
  .describe('What the SNS message is: a delivery report, or one step of the subscription handshake.');

export const SnsMessageSchema = z.object({
  Type: SnsMessageTypeSchema,
  MessageId: z.string().min(1).describe('SNS\'s id for this message.'),
  TopicArn: z.string().min(1).describe('The SNS topic that sent it; core-api accepts only its own.'),
  Subject: z.string().optional().describe('Optional subject, signed when present.'),
  Message: z.string().describe('The payload: for a Notification, the SES event as a JSON string.'),
  Timestamp: z.string().min(1).describe('When SNS published the message (ISO 8601).'),
  SignatureVersion: z.enum(['1', '2']).describe('1 signs with SHA1, 2 with SHA256.'),
  Signature: z.string().min(1).describe('Base64 RSA signature over the message\'s signed fields.'),
  SigningCertURL: z.string().min(1).describe('Where SNS serves the certificate that signed it; must be an sns.<region>.amazonaws.com https URL.'),
  SubscribeURL: z.string().optional().describe('On a subscription confirmation, the URL that confirms the subscription.'),
  Token: z.string().optional().describe('On a subscription confirmation, the confirmation token.'),
}).describe('A message from Amazon SNS, as posted to an HTTPS subscription.');
export type SnsMessage = z.infer<typeof SnsMessageSchema>;

registerSchema('SnsMessageType', SnsMessageTypeSchema);
registerSchema('SnsMessage', SnsMessageSchema);
