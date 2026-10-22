/**
 * SNS messages signed the way SNS signs them (#844 slice 4), with a key pair made for the test run,
 * so the verifier and the events route are tested against real signatures. `fetchCertificate`
 * hands the verifier this key's public half in place of the certificate SNS would serve.
 */

import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import type { SnsMessage } from '@poolmaster/shared/dto';

export const TEST_TOPIC_ARN = 'arn:aws:sns:us-east-2:123456789012:poolmaster-test-ses-events';
export const TEST_SIGNING_CERT_URL = 'https://sns.us-east-2.amazonaws.com/SimpleNotificationService-test.pem';

const SIGNED_FIELDS: Record<SnsMessage['Type'], (keyof SnsMessage)[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

export interface SnsSigner {
  /** The public key, PEM, standing in for the certificate at the signing URL. */
  certificate: string;
  fetchCertificate: (url: string) => Promise<string>;
  /** A signed message; `overrides` are applied before signing. */
  sign: (overrides: Partial<SnsMessage> & Pick<SnsMessage, 'Type'>) => SnsMessage;
}

export function snsSigner(): SnsSigner {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const certificate = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    certificate,
    fetchCertificate: () => Promise.resolve(certificate),
    sign(overrides) {
      const unsigned: SnsMessage = {
        MessageId: randomUUID(),
        TopicArn: TEST_TOPIC_ARN,
        Message: '{}',
        Timestamp: '2026-10-22T12:00:00.000Z',
        SignatureVersion: '2',
        Signature: '',
        SigningCertURL: TEST_SIGNING_CERT_URL,
        ...overrides,
      };
      let signed = '';
      for (const field of SIGNED_FIELDS[unsigned.Type]) {
        const value = unsigned[field];
        if (value !== undefined) signed += `${field}\n${value}\n`;
      }
      const signer = createSign(unsigned.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
      signer.update(signed, 'utf8');
      return { ...unsigned, Signature: signer.sign(privateKey, 'base64') };
    },
  };
}

/** The SES event JSON a Notification carries, for one sent email. */
export function sesEvent(
  eventType: 'Delivery' | 'Bounce' | 'Complaint' | 'Reject',
  providerMessageId: string,
  details: Record<string, unknown> = {},
): string {
  return JSON.stringify({ eventType, mail: { messageId: providerMessageId }, ...details });
}

export function permanentBounce(providerMessageId: string, ...addresses: string[]): string {
  return sesEvent('Bounce', providerMessageId, {
    bounce: {
      bounceType: 'Permanent',
      bounceSubType: 'General',
      bouncedRecipients: addresses.map((emailAddress) => ({ emailAddress })),
    },
  });
}

export function complaint(providerMessageId: string, ...addresses: string[]): string {
  return sesEvent('Complaint', providerMessageId, {
    complaint: { complainedRecipients: addresses.map((emailAddress) => ({ emailAddress })) },
  });
}
