import { enumLabel } from '@poolmaster/shared/display-strings';
import { EmailAudience, EmailTemplateKey, type LeaguePlan } from '@poolmaster/shared/domain';

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
    audience: EmailAudience.PEOPLE_INVITED,
    when: 'A commissioner invites someone to the league',
  },
  [EmailTemplateKey.LEAGUE_JOIN_SUCCESS]: {
    audience: EmailAudience.MEMBERS,
    when: 'Someone joins a league',
  },
  [EmailTemplateKey.SQUAD_OWNER_INVITE]: {
    audience: EmailAudience.PEOPLE_INVITED,
    when: 'A team owner invites someone with no account to share the team',
  },
  [EmailTemplateKey.SQUAD_OWNER_ADDED]: {
    audience: EmailAudience.MEMBERS,
    when: 'A team owner adds someone with an account to the team',
  },
  [EmailTemplateKey.LEAGUE_MEMBER_JOINED]: {
    audience: EmailAudience.COMMISSIONERS,
    when: 'Someone joins the league; a busy day\'s rest go together the next day',
  },
  [EmailTemplateKey.CONTEST_EXPANDED]: {
    audience: EmailAudience.COMMISSIONERS,
    when: 'One of the league\'s contests is expanded',
  },
  [EmailTemplateKey.LEAGUE_PLAN_PREVIEW_ENDING]: {
    audience: EmailAudience.COMMISSIONERS,
    when: '30, 7 and 1 days before the league\'s Premium preview period ends',
  },
  [EmailTemplateKey.CONTEST_OPENED]: {
    audience: EmailAudience.MEMBERS,
    when: 'A contest opens for entries',
  },
  [EmailTemplateKey.CONTEST_ENTRY_COMPLETED]: {
    audience: EmailAudience.MEMBERS,
    when: 'An entry is submitted',
  },
  [EmailTemplateKey.CONTEST_ENTRY_REMINDER]: {
    audience: EmailAudience.MEMBERS,
    when: 'Picks close soon and the member has nothing submitted',
  },
  [EmailTemplateKey.CONTEST_STARTED_SUMMARY]: {
    audience: EmailAudience.MEMBERS,
    when: 'A contest\'s event starts and the contest goes live',
  },
  [EmailTemplateKey.CONTEST_STANDINGS]: {
    audience: EmailAudience.MEMBERS,
    when: 'A round or event of a live contest finishes',
  },
  [EmailTemplateKey.CONTEST_RESULTS]: {
    audience: EmailAudience.MEMBERS,
    when: 'A contest is settled',
  },
  [EmailTemplateKey.CONTEST_EVENT_CHANGED]: {
    audience: EmailAudience.MEMBERS,
    when: 'A contest\'s event is postponed or cancelled',
  },
  [EmailTemplateKey.CONTEST_REOPENED]: {
    audience: EmailAudience.MEMBERS,
    when: 'A postponement takes a live contest back to open, in place of "Event postponed"',
  },
  [EmailTemplateKey.EVENT_COMING_UP]: {
    audience: EmailAudience.COMMISSIONERS,
    when: 'An event starts in 7 to 10 days',
  },
  [EmailTemplateKey.EVENT_READY_FOR_CONTESTS]: {
    audience: EmailAudience.COMMISSIONERS,
    when: 'A released event starts within 7 days and the league has no contest on it',
  },
  [EmailTemplateKey.EVENT_WEEKLY_DIGEST]: {
    audience: EmailAudience.COMMISSIONERS,
    when: 'Every Monday, for a league that gets one digest instead of each event',
  },
  [EmailTemplateKey.CONTEST_NOT_OPEN]: {
    audience: EmailAudience.COMMISSIONERS,
    when: 'A contest still in set up has picks closing within 48 hours',
  },
  [EmailTemplateKey.YEAR_IN_REVIEW]: {
    audience: EmailAudience.MEMBERS,
    when: 'A commissioner sends last year\'s review',
  },
  [EmailTemplateKey.EVENT_STILL_DRAFT]: {
    audience: EmailAudience.ROOT_ADMINS,
    when: 'Once a day while an event starting within 7 days is still a draft',
  },
  [EmailTemplateKey.PASSWORD_RESET]: {
    audience: EmailAudience.ACCOUNT_HOLDERS,
    when: 'Someone asks to reset their password',
  },
  [EmailTemplateKey.PASSWORD_CHANGED]: {
    audience: EmailAudience.ACCOUNT_HOLDERS,
    when: 'An account\'s password is changed',
  },
  [EmailTemplateKey.EMAIL_CHANGED]: {
    audience: EmailAudience.ACCOUNT_HOLDERS,
    when: 'An account\'s email address is changed; it goes to the old address',
  },
  [EmailTemplateKey.EMAIL_TEST]: {
    audience: EmailAudience.ROOT_ADMINS,
    when: 'A root admin presses Check delivery',
  },
};

/** The Plan column's value for an email every league gets, whatever its plan. */
export const EVERY_PLAN = 'EVERY_PLAN';

/** Where an email's plan starts, in words: "Pro", or "Every plan" for one every league gets. */
export function planText(planStartsAt: LeaguePlan | null): string {
  return planStartsAt === null ? 'Every plan' : enumLabel('LeaguePlan', planStartsAt);
}
