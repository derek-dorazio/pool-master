/**
 * #848 — reads the emails the local browser-E2E stack sent, from the Mailpit service its CI job
 * runs (`POOLMASTER_E2E_MAILPIT_URL`). Only untagged specs use it: they run against the local
 * stack, never against QA, whose email goes nowhere a spec can read.
 */

type MailpitSummary = { ID: string; Subject: string };
type MailpitMessage = { Text: string };

export function readMailpitUrl(): string {
  const url = process.env.POOLMASTER_E2E_MAILPIT_URL;
  if (!url) {
    throw new Error('POOLMASTER_E2E_MAILPIT_URL is not set: this spec reads email from the local stack\'s Mailpit.');
  }
  return url.replace(/\/+$/, '');
}

/** The plain-text body of the newest email to `address` with `subject`, waiting up to 20 s for it. */
export async function waitForMailText(address: string, subject: string): Promise<string> {
  const mailpit = readMailpitUrl();
  const deadline = Date.now() + 20_000;
  for (;;) {
    const search = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
    if (!search.ok) {
      throw new Error(`Mailpit search answered ${search.status}`);
    }
    const { messages } = (await search.json()) as { messages: MailpitSummary[] };
    const match = messages.find((message) => message.Subject === subject);
    if (match) {
      const message = await fetch(`${mailpit}/api/v1/message/${match.ID}`);
      return ((await message.json()) as MailpitMessage).Text;
    }
    if (Date.now() > deadline) {
      throw new Error(`No email "${subject}" reached ${address} within 20 s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
