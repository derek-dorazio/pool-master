import { enumLabel } from '@poolmaster/shared/display-strings';
import { EmailTemplateKey, explicitOrder, type LeaguePlan } from '@poolmaster/shared/domain';

/** Who a system email goes to: a code, worded by `EMAIL_AUDIENCE_LABELS`. */
export const EMAIL_AUDIENCE = {
  MEMBERS: 'MEMBERS',
  COMMISSIONERS: 'COMMISSIONERS',
  ROOT_ADMINS: 'ROOT_ADMINS',
  PEOPLE_INVITED: 'PEOPLE_INVITED',
  ACCOUNT_HOLDERS: 'ACCOUNT_HOLDERS',
} as const;
export type EmailAudience = (typeof EMAIL_AUDIENCE)[keyof typeof EMAIL_AUDIENCE];

/** The Audience column's order: the widest group first, then the people who run leagues and the site. */
export const EmailAudienceOrder = explicitOrder<EmailAudience>({
  [EMAIL_AUDIENCE.ACCOUNT_HOLDERS]: 0,
  [EMAIL_AUDIENCE.MEMBERS]: 1,
  [EMAIL_AUDIENCE.PEOPLE_INVITED]: 2,
  [EMAIL_AUDIENCE.COMMISSIONERS]: 3,
  [EMAIL_AUDIENCE.ROOT_ADMINS]: 4,
});

/** Each audience as the Notifications page says it. */
export const EMAIL_AUDIENCE_LABELS: Record<EmailAudience, string> = {
  [EMAIL_AUDIENCE.MEMBERS]: 'Members',
  [EMAIL_AUDIENCE.COMMISSIONERS]: 'Commissioners',
  [EMAIL_AUDIENCE.ROOT_ADMINS]: 'Root admins',
  [EMAIL_AUDIENCE.PEOPLE_INVITED]: 'People invited',
  [EMAIL_AUDIENCE.ACCOUNT_HOLDERS]: 'Account holders',
};

export type SystemEmailLabel = {
  audience: EmailAudience;
  /** What makes it go out, in a short sentence. */
  when: string;
};

/**
 * Every system email in the root admin's words (#1872): who gets it and what sends it. Its name is
 * its EmailTemplateKey's display string (`enumLabel('EmailTemplateKey', key)`).
 * A key added to EmailTemplateKey without an entry here is a compile error.
 */
export const SYSTEM_EMAIL_LABELS: Record<EmailTemplateKey, SystemEmailLabel> = {
  [EmailTemplateKey.LEAGUE_MEMBER_INVITE]: {
    audience: EMAIL_AUDIENCE.PEOPLE_INVITED,
    when: 'A commissioner invites someone to the league',
  },
  [EmailTemplateKey.LEAGUE_JOIN_SUCCESS]: {
    audience: EMAIL_AUDIENCE.MEMBERS,
    when: 'Someone joins a league',
  },
  [EmailTemplateKey.SQUAD_OWNER_INVITE]: {
    audience: EMAIL_AUDIENCE.PEOPLE_INVITED,
    when: 'A team owner invites someone with no account to share the team',
  },
  [EmailTemplateKey.SQUAD_OWNER_ADDED]: {
    audience: EMAIL_AUDIENCE.MEMBERS,
    when: 'A team owner adds someone with an account to the team',
  },
  [EmailTemplateKey.LEAGUE_MEMBER_JOINED]: {
    audience: EMAIL_AUDIENCE.COMMISSIONERS,
    when: 'Someone joins the league; a busy day\'s rest go together the next day',
  },
  [EmailTemplateKey.CONTEST_EXPANDED]: {
    audience: EMAIL_AUDIENCE.COMMISSIONERS,
    when: 'One of the league\'s contests is expanded',
  },
  [EmailTemplateKey.LEAGUE_PLAN_PREVIEW_ENDING]: {
    audience: EMAIL_AUDIENCE.COMMISSIONERS,
    when: '30, 7 and 1 days before the league\'s Premium preview period ends',
  },
  [EmailTemplateKey.CONTEST_OPENED]: {
    audience: EMAIL_AUDIENCE.MEMBERS,
    when: 'A contest opens for entries',
  },
  [EmailTemplateKey.CONTEST_ENTRY_COMPLETED]: {
    audience: EMAIL_AUDIENCE.MEMBERS,
    when: 'An entry is submitted',
  },
  [EmailTemplateKey.CONTEST_ENTRY_REMINDER]: {
    audience: EMAIL_AUDIENCE.MEMBERS,
    when: 'Picks close soon and the member has nothing submitted',
  },
  [EmailTemplateKey.CONTEST_STARTED_SUMMARY]: {
    audience: EMAIL_AUDIENCE.MEMBERS,
    when: 'A contest\'s event starts and the contest goes live',
  },
  [EmailTemplateKey.CONTEST_STANDINGS]: {
    audience: EMAIL_AUDIENCE.MEMBERS,
    when: 'A round or event of a live contest finishes',
  },
  [EmailTemplateKey.CONTEST_RESULTS]: {
    audience: EMAIL_AUDIENCE.MEMBERS,
    when: 'A contest is settled',
  },
  [EmailTemplateKey.CONTEST_EVENT_CHANGED]: {
    audience: EMAIL_AUDIENCE.MEMBERS,
    when: 'A contest\'s event is postponed or cancelled',
  },
  [EmailTemplateKey.CONTEST_REOPENED]: {
    audience: EMAIL_AUDIENCE.MEMBERS,
    when: 'A postponement takes a live contest back to open, in place of "Event postponed"',
  },
  [EmailTemplateKey.EVENT_COMING_UP]: {
    audience: EMAIL_AUDIENCE.COMMISSIONERS,
    when: 'An event starts in 7 to 10 days',
  },
  [EmailTemplateKey.EVENT_READY_FOR_CONTESTS]: {
    audience: EMAIL_AUDIENCE.COMMISSIONERS,
    when: 'A released event starts within 7 days and the league has no contest on it',
  },
  [EmailTemplateKey.EVENT_WEEKLY_DIGEST]: {
    audience: EMAIL_AUDIENCE.COMMISSIONERS,
    when: 'Every Monday, for a league that gets one digest instead of each event',
  },
  [EmailTemplateKey.CONTEST_NOT_OPEN]: {
    audience: EMAIL_AUDIENCE.COMMISSIONERS,
    when: 'A contest still in set up has picks closing within 48 hours',
  },
  [EmailTemplateKey.YEAR_IN_REVIEW]: {
    audience: EMAIL_AUDIENCE.MEMBERS,
    when: 'A commissioner sends last year\'s review',
  },
  [EmailTemplateKey.EVENT_STILL_DRAFT]: {
    audience: EMAIL_AUDIENCE.ROOT_ADMINS,
    when: 'Once a day while an event starting within 7 days is still a draft',
  },
  [EmailTemplateKey.PASSWORD_RESET]: {
    audience: EMAIL_AUDIENCE.ACCOUNT_HOLDERS,
    when: 'Someone asks to reset their password',
  },
  [EmailTemplateKey.PASSWORD_CHANGED]: {
    audience: EMAIL_AUDIENCE.ACCOUNT_HOLDERS,
    when: 'An account\'s password is changed',
  },
  [EmailTemplateKey.EMAIL_CHANGED]: {
    audience: EMAIL_AUDIENCE.ACCOUNT_HOLDERS,
    when: 'An account\'s email address is changed; it goes to the old address',
  },
  [EmailTemplateKey.EMAIL_TEST]: {
    audience: EMAIL_AUDIENCE.ROOT_ADMINS,
    when: 'A root admin presses Check delivery',
  },
};

/** The Plan column's value for an email every league gets, whatever its plan. */
export const EVERY_PLAN = 'EVERY_PLAN';

/** Where an email's plan starts, in words: "Pro", or "Every plan" for one every league gets. */
export function planText(planStartsAt: LeaguePlan | null): string {
  return planStartsAt === null ? 'Every plan' : enumLabel('LeaguePlan', planStartsAt);
}
