/**
 * The end of a league's Premium preview period (#986, plans/payments.md §3). Every league is
 * gifted Premium until its renewal date; its commissioners are reminded 30, 7 and 1 days before,
 * and once the date has passed the league moves to Free, with no grace period.
 *
 * The lifecycle scheduler's "notifications due" step calls `queueDue` on every sweep. Reminders go
 * once the overnight hour (EMAIL_CONFIG.weeklyDigestHour, 3am Eastern by default) has come, on the
 * day that is 30, 7 or 1 days, counted in US Eastern dates, before the renewal date. A league that
 * missed one (its sweep was down, or a root admin set the date sooner) gets only the most urgent
 * one due. Each reminder goes once per league and renewal date, its outbox idempotency key being
 * the date, the reminder and the league, so a root admin extending the gift starts the reminders
 * over for the new date. The move to Free follows the reminders on every sweep.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { LeagueRepository } from '@poolmaster/shared/db';
import { LeaguePlan, LeagueRole, PlanCap, type League } from '@poolmaster/shared/domain';
import type { EmailConfig } from '@poolmaster/shared/dto';
import {
  buildLeaguePlanUrl,
  formatUserName,
  PLAN_PREVIEW_REMINDER_DAYS,
  type EmailService,
  type PlanPreviewReminderDays,
} from '../email';
import type { DueNotifications } from '../events/event-lifecycle-scheduler';
import type { LeaguePlanService } from '../plans/league-plan-service';
import type { PlanEntitlementsService } from '../plans/plan-entitlements-service';
import { activeLeagueMembersWithRoles, type LeagueMemberDeps } from './league-members';
import { easternDateOf, easternDayOf } from './overnight-day';

const DAY_MS = 24 * 60 * 60_000;
/** Far enough ahead to cover every renewal date the first reminder is due for, in US Eastern dates. */
const LOOKAHEAD_MS = (Math.max(...PLAN_PREVIEW_REMINDER_DAYS) + 1) * DAY_MS;

export interface PlanPreviewNoticeDeps extends LeagueMemberDeps {
  leagues: Pick<LeagueRepository, 'findPlansEndingBetween'>;
  plans: Pick<LeaguePlanService, 'moveEndedToFree'>;
  /** The reminder says what Free allows. */
  planEntitlements: Pick<PlanEntitlementsService, 'forPlan'>;
  email: Pick<EmailService, 'send' | 'leaguesRecorded'>;
  /** Reminders go at the overnight hour every scheduled league email uses. */
  readConfig: () => Pick<EmailConfig, 'weeklyDigestHour'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}

/** Whole days from one YYYY-MM-DD date to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
}

/** The most urgent reminder due `daysLeft` days before the end, or null for none. */
function reminderFor(daysLeft: number): PlanPreviewReminderDays | null {
  if (daysLeft < 1) return null;
  return [...PLAN_PREVIEW_REMINDER_DAYS].reverse().find((days) => days >= daysLeft) ?? null;
}

/** The reminder's outbox subject, less the league: one per renewal date and reminder. */
function reminderAbout(renewsAt: Date, days: PlanPreviewReminderDays): string {
  return `${renewsAt.toISOString()}:${String(days)}`;
}

export class PlanPreviewNotices implements DueNotifications {
  constructor(private readonly deps: PlanPreviewNoticeDeps) {}

  /** The reminders due, then every league whose preview period has ended moves to Free. */
  async queueDue(now: Date): Promise<void> {
    try {
      await this.remind(now);
    } finally {
      await this.deps.plans.moveEndedToFree(now);
    }
  }

  private async remind(now: Date): Promise<void> {
    const today = easternDayOf(now, this.deps.readConfig().weeklyDigestHour);
    if (today === null) return;
    const due = (await this.deps.leagues.findPlansEndingBetween(now, new Date(now.getTime() + LOOKAHEAD_MS)))
      .flatMap((league) => {
        const days = reminderFor(daysBetween(today, easternDateOf(league.planRenewsAt)));
        return days === null ? [] : [{ league, days, about: reminderAbout(league.planRenewsAt, days) }];
      });
    const sent = new Map<string, Set<string>>();
    for (const { league, days, about } of due) {
      try {
        let told = sent.get(about);
        if (told === undefined) {
          told = await this.deps.email.leaguesRecorded('LEAGUE_PLAN_PREVIEW_ENDING', about);
          sent.set(about, told);
        }
        if (told.has(league.id)) continue;
        await this.send(league, days, `${about}:${league.id}`);
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.planPreviewEnding.failed',
          data: { leagueId: league.id, days, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue the Premium preview period ending email');
      }
    }
  }

  private async send(league: League, daysLeft: PlanPreviewReminderDays, about: string): Promise<void> {
    const free = this.deps.planEntitlements.forPlan(LeaguePlan.FREE).caps;
    const planUrl = buildLeaguePlanUrl(this.deps.appBaseUrl, league.leagueCode);
    const members = await activeLeagueMembersWithRoles(this.deps, league.id);
    for (const { user } of members.filter(({ role }) => role === LeagueRole.COMMISSIONER)) {
      await this.deps.email.send('LEAGUE_PLAN_PREVIEW_ENDING', {
        to: { email: user.email, userId: user.id, timeZone: user.timezone },
        about,
        league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
        data: {
          userName: formatUserName(user),
          leagueName: league.name,
          daysLeft,
          endsAt: league.planRenewsAt,
          freeEntriesPerContest: free[PlanCap.ENTRIES_PER_CONTEST],
          freeSportsLeaguesPerYear: free[PlanCap.SPORTS_LEAGUES_PER_YEAR],
          planUrl,
        },
      });
    }
  }
}
