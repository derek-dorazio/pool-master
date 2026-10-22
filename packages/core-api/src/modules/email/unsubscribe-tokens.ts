/**
 * The token in an email's "Stop these emails" link and List-Unsubscribe header (#844 slice 5,
 * plans/email-delivery-ses.md §7). It names one user and one category, works without signing in
 * and never expires, so it can do one thing only: turn that category off for that user.
 *
 * It is an HMAC over the user id and the category with a key derived from JWT_SECRET for this
 * purpose alone. It is deliberately not a JWT: access tokens are JWTs signed with JWT_SECRET
 * itself, and a token that verified as one would sign its holder in.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { OptionalEmailCategory } from '@poolmaster/shared/domain';

const PURPOSE = 'poolmaster:email-unsubscribe:v1';

export interface UnsubscribeTarget {
  userId: string;
  category: OptionalEmailCategory;
}

export class UnsubscribeTokens {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHmac('sha256', secret).update(PURPOSE).digest();
  }

  issue(target: UnsubscribeTarget): string {
    const userId = Buffer.from(target.userId, 'utf8').toString('base64url');
    return `${userId}.${target.category}.${this.mac(target).toString('base64url')}`;
  }

  /** The user and category a token names, or undefined for anything this app did not issue. */
  read(token: string): UnsubscribeTarget | undefined {
    const [encodedUserId, category, mac, ...rest] = token.split('.');
    if (!encodedUserId || !category || !mac || rest.length > 0 || !isOptionalCategory(category)) return undefined;
    const target = { userId: Buffer.from(encodedUserId, 'base64url').toString('utf8'), category };
    const expected = this.mac(target);
    const given = Buffer.from(mac, 'base64url');
    return given.length === expected.length && timingSafeEqual(given, expected) ? target : undefined;
  }

  private mac(target: UnsubscribeTarget): Buffer {
    return createHmac('sha256', this.key).update(`${target.userId}\n${target.category}`).digest();
  }
}

function isOptionalCategory(value: string): value is OptionalEmailCategory {
  return Object.values<string>(OptionalEmailCategory).includes(value);
}
