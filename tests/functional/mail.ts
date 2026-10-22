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

const MAIL_WAIT_MS = 10_000;
const MAIL_POLL_MS = 100;

/**
 * Waits for `count` emails to `address` (with `subject`, when given) to reach the sink, since
 * the outbox's sender sends a moment after the request that queued them (#844). Returns what
 * arrived, which is short of `count` only when the wait ran out, so the caller's length
 * assertion fails with what was seen.
 */
export async function awaitSentMailTo(address: string, count: number, subject?: string): Promise<CapturedMail[]> {
  const deadline = Date.now() + MAIL_WAIT_MS;
  for (;;) {
    const mail = subject === undefined ? await sentMailTo(address) : await sentMailWithSubject(address, subject);
    if (mail.length >= count || Date.now() >= deadline) return mail;
    await new Promise((resolve) => { setTimeout(resolve, MAIL_POLL_MS); });
  }
}
