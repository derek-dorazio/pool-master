import type { CapturedMail } from '../support/smtp-sink';
import { readFunctionalServerState } from './state';

/**
 * The emails the functional server has sent, read from its SMTP sink (#442). The server is a
 * daemon shared by concurrent runs, so callers filter by a recipient address their own test
 * created rather than counting the whole inbox.
 */
export async function readSentMail(): Promise<CapturedMail[]> {
  const { mailInboxUrl } = readFunctionalServerState();
  if (!mailInboxUrl) {
    throw new Error(
      'The functional server state has no mailInboxUrl: a daemon started by older code is still '
        + 'running. Stop it (coverage/service-functional-api/daemon/server-state.json has its pid) and re-run.',
    );
  }
  const response = await fetch(`${mailInboxUrl}/messages`);
  if (!response.ok) {
    throw new Error(`Mail inbox returned ${response.status}`);
  }
  return (await response.json()) as CapturedMail[];
}

/** Every captured email addressed to `address`, oldest first. */
export async function sentMailTo(address: string): Promise<CapturedMail[]> {
  const wanted = address.toLowerCase();
  return (await readSentMail()).filter((mail) =>
    mail.to.some((recipient) => recipient.toLowerCase() === wanted));
}

/** The captured emails to `address` whose subject is exactly `subject`. */
export async function sentMailWithSubject(address: string, subject: string): Promise<CapturedMail[]> {
  return (await sentMailTo(address)).filter((mail) => mail.subject === subject);
}

/** Every http(s) URL in a plain-text email body, in order. */
export function linksIn(mail: CapturedMail): string[] {
  return mail.text.match(/https?:\/\/[^\s<>"]+/g) ?? [];
}
