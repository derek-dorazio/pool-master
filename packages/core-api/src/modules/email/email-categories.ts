/**
 * The email categories (#844, #845). Each system email sits in one; the category decides whether
 * a member can turn the email off and which unsubscribe link it carries. The list is the
 * notification catalog's (`plans/email-notifications.md` §2).
 */
export const EmailCategory = {
  /** Account and security. Can't be turned off. */
  ACCOUNT: 'ACCOUNT',
  /** Invitations and membership. Can't be turned off. */
  MEMBERSHIP: 'MEMBERSHIP',
  COMMISSIONER_UPDATES: 'COMMISSIONER_UPDATES',
  CONTEST_UPDATES: 'CONTEST_UPDATES',
  LIVE_STANDINGS: 'LIVE_STANDINGS',
  RESULTS: 'RESULTS',
  RECEIPTS: 'RECEIPTS',
} as const;
export type EmailCategory = (typeof EmailCategory)[keyof typeof EmailCategory];
