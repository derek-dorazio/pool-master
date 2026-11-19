import type { SentEmailContent } from '@poolmaster/shared/db';
import {
  REMOVED_LINK_HTML,
  REMOVED_LINK_TEXT,
  withoutMemberLinks,
} from '../../../packages/core-api/src/modules/email/member-link-redaction';

const TOKEN = 'eyJ1c2VySWQiOiJtZW1iZXItMSJ9.c2lnbmF0dXJl';

function content(htmlBody: string, textBody: string): SentEmailContent {
  return {
    id: 'sent-1',
    templateKey: 'CONTEST_RESULTS',
    recipientEmail: 'member@gmail.com',
    fromName: 'Office League',
    fromAddress: 'office24@qa.example.com',
    subject: 'Final results',
    textBody,
    htmlBody,
    sentAt: new Date('2026-11-18T12:00:00.000Z'),
  };
}

describe('member link redaction: what a root admin\'s preview and copy may carry', () => {
  it('makes the footer\'s "Stop these emails" link dead in the HTML and the text, so the member\'s unsubscribe token is gone', () => {
    const unsubscribe = `https://qa.example.com/email/unsubscribe?token=${TOKEN}`;

    const redacted = withoutMemberLinks(content(
      `<p><a href="${unsubscribe}">Stop these emails</a></p>`,
      `Stop these emails: ${unsubscribe}\n`,
    ));

    expect(redacted.htmlBody).toBe(`<p><a href="${REMOVED_LINK_HTML}">Stop these emails</a></p>`);
    expect(redacted.textBody).toBe(`Stop these emails: ${REMOVED_LINK_TEXT}\n`);
    expect(`${redacted.htmlBody}${redacted.textBody}`).not.toContain(TOKEN);
  });

  it('makes the one-click unsubscribe address dead too, whatever origin it names', () => {
    const redacted = withoutMemberLinks(content(
      `<a href="https://www.example.org/api/v1/email/unsubscribe?token=${TOKEN}">x</a>`,
      `https://www.example.org/api/v1/email/unsubscribe?token=${TOKEN}`,
    ));

    expect(redacted.htmlBody).toBe(`<a href="${REMOVED_LINK_HTML}">x</a>`);
    expect(redacted.textBody).toBe(REMOVED_LINK_TEXT);
  });

  it('makes league and co-owner invitation links dead, so their invite codes are gone', () => {
    const redacted = withoutMemberLinks(content(
      '<a href="https://qa.example.com/invite/LEAGUE-CODE-9">Join league</a> <a href="https://qa.example.com/team-invite/OWNER-CODE-7">Accept invitation</a>',
      'Join league: https://qa.example.com/invite/LEAGUE-CODE-9\nAccept invitation: https://qa.example.com/team-invite/OWNER-CODE-7',
    ));

    expect(redacted.htmlBody).toBe(`<a href="${REMOVED_LINK_HTML}">Join league</a> <a href="${REMOVED_LINK_HTML}">Accept invitation</a>`);
    expect(redacted.textBody).toBe(`Join league: ${REMOVED_LINK_TEXT}\nAccept invitation: ${REMOVED_LINK_TEXT}`);
    expect(`${redacted.htmlBody}${redacted.textBody}`).not.toMatch(/LEAGUE-CODE-9|OWNER-CODE-7/);
  });

  it('keeps every other link, the subject and the rest of the email exactly as sent', () => {
    const html = '<a href="https://qa.example.com/leagues/l-1/contests/c-1">See the leaderboard</a>';
    const text = 'See the leaderboard: https://qa.example.com/leagues/l-1/contests/c-1';

    const redacted = withoutMemberLinks(content(html, text));

    expect(redacted).toEqual(content(html, text));
  });
});
