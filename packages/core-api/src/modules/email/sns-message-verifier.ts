/**
 * Checks that an SNS message really came from AWS (#844 slice 4), before core-api acts on an SES
 * delivery report it carries. SNS signs every message with a certificate it serves from an
 * `sns.<region>.amazonaws.com` URL; the message names that URL, so the URL is checked before the
 * certificate is fetched, and the signature is checked against the certificate.
 * https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 */

import { createVerify } from 'node:crypto';
import type { SnsMessage } from '@poolmaster/shared/dto';

/** The only hosts SNS signs from and confirms subscriptions on. */
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

/** The fields signed for each message type, in the order SNS signs them. */
const SIGNED_FIELDS = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
} as const satisfies Record<SnsMessage['Type'], readonly (keyof SnsMessage)[]>;

const SIGNATURE_ALGORITHMS = { '1': 'RSA-SHA1', '2': 'RSA-SHA256' } as const;

/** Whether `url` is an https URL on an SNS host, as a signing certificate or subscribe URL must be. */
export function isSnsUrl(url: string, pathSuffix?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:'
    && SNS_HOST.test(parsed.hostname)
    && parsed.port === ''
    && (pathSuffix === undefined || parsed.pathname.endsWith(pathSuffix));
}

export interface SnsMessageVerifierOptions {
  /** Fetches a signing certificate (PEM). The app's uses fetch; tests pass their own. */
  fetchCertificate?: (url: string) => Promise<string>;
}

export class SnsMessageVerifier {
  private readonly certificates = new Map<string, Promise<string>>();
  private readonly fetchCertificate: (url: string) => Promise<string>;

  constructor(options: SnsMessageVerifierOptions = {}) {
    this.fetchCertificate = options.fetchCertificate ?? fetchText;
  }

  /** True only for a message signed by SNS with a certificate from an SNS host. */
  async verify(message: SnsMessage): Promise<boolean> {
    if (!isSnsUrl(message.SigningCertURL, '.pem')) return false;
    let certificate: string;
    try {
      certificate = await this.certificate(message.SigningCertURL);
    } catch {
      return false;
    }
    const verifier = createVerify(SIGNATURE_ALGORITHMS[message.SignatureVersion]);
    verifier.update(stringToSign(message), 'utf8');
    try {
      return verifier.verify(certificate, message.Signature, 'base64');
    } catch {
      return false;
    }
  }

  /** Certificates rarely change, so each is fetched once; a failed fetch is tried again next time. */
  private certificate(url: string): Promise<string> {
    let pending = this.certificates.get(url);
    if (!pending) {
      pending = this.fetchCertificate(url);
      this.certificates.set(url, pending);
      pending.catch(() => { this.certificates.delete(url); });
    }
    return pending;
  }
}

function stringToSign(message: SnsMessage): string {
  let signed = '';
  for (const field of SIGNED_FIELDS[message.Type]) {
    const value = message[field];
    // Subject is signed only when the message has one.
    if (value !== undefined) signed += `${field}\n${value}\n`;
  }
  return signed;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetching ${url} answered ${String(response.status)}`);
  return response.text();
}
