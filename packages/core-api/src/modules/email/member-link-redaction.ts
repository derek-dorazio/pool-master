/**
 * A sent email's content without the links that act for the person it went to (#1870), for the
 * root admin's preview and copy of it. The footer's "Stop these emails" link carries that
 * member's unsubscribe token, its whole authority, and an invitation's link its invite code,
 * which accepting spends: in a copy either would act on someone else's account. Each becomes a
 * dead link; every other link (the league, the contest, the leaderboard) is kept.
 */
import type { SentEmailContent } from '@poolmaster/shared/db';
import { ONE_CLICK_UNSUBSCRIBE_PATH, UNSUBSCRIBE_PAGE_PATH } from './email-service';

/** What a removed link becomes: an inert `#` in HTML, a note in the text. */
export const REMOVED_LINK_HTML = '#';
export const REMOVED_LINK_TEXT = '(link removed in this copy)';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A whole URL: any origin, then the path, then what follows up to a quote, space or tag. */
const URL_START = String.raw`https?://[^\s"'<>]+?`;
const MEMBER_LINKS = new RegExp(
  [
    // An unsubscribe page or one-click address, with its token.
    `${URL_START}(?:${escapeRegExp(UNSUBSCRIBE_PAGE_PATH)}|${escapeRegExp(ONE_CLICK_UNSUBSCRIBE_PATH)})\\?[^\\s"'<>]*`,
    // A league or co-owner invitation, with its code.
    String.raw`${URL_START}/(?:team-)?invite/[^\s"'<>]+`,
  ].join('|'),
  'g',
);

/** `content` with every link that acts for its first recipient made dead, in the HTML and the text. */
export function withoutMemberLinks(content: SentEmailContent): SentEmailContent {
  return {
    ...content,
    htmlBody: content.htmlBody.replace(MEMBER_LINKS, REMOVED_LINK_HTML),
    textBody: content.textBody.replace(MEMBER_LINKS, REMOVED_LINK_TEXT),
  };
}
