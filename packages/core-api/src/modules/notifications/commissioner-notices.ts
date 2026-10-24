/**
 * The clock-driven emails that help a commissioner set up contests (#845): "Coming up soon" (C1)
 * about 10 days before an event starts, "Ready for contests" (C2) once it is released and starts
 * within 7 days, and "Your contest isn't open yet" (C4) when a contest is still a draft 48 hours
 * before its picks close.
 *
 * C1 and C2 go to every active commissioner of every active league, for the events of every
 * sport league the league hasn't muted (#851); each league sends its own, so a commissioner of
 * two leagues gets one from each. C2 skips a league that already has a contest on the event. A sport league whose events
 * are weeks (each NFL week is its own event) is told only of its season's first week, not every
 * week. C4 goes to the contest's league's commissioners.
 *
 * The lifecycle scheduler's "notifications due" step calls `queueDue` on every sweep. Each email
 * is queued once: its outbox idempotency key is the event and league (C1, C2) or the contest
 * (C4) and the person, and a league or contest already told is skipped before any work. So if a
 * send fails partway through a league's commissioners, the rest of that league is not told.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestRepository,
  LeagueRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import {
  ContestStatus,
  ContestTemplateEventType,
  LeagueRole,
  SportEventStatus,
  contestTemplateEventTypeOf,
  countParticipants,
  getSportDefinition,
  isTemplateOfferedOn,
  type Contest,
  type League,
  type SportEvent,
  type User,
} from '@poolmaster/shared/domain';
import type { ContestService } from '../contests/service';
import {
  buildContestAdminUrl,
  buildCreateContestUrl,
  buildLeagueAdminContestsUrl,
  formatUserName,
  type ContestSetupLink,
  type EmailService,
  type PreviousContestWinners,
} from '../email';
import type { DueNotifications } from '../events/event-lifecycle-scheduler';
import { contestClosesAt, type ContestSummaryDeps } from './contest-summary';
import { activeLeagueMembersWithRoles, type LeagueMemberDeps } from './league-members';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** C1 goes this long before an event starts. */
const COMING_UP_MS = 10 * DAY_MS;
/** C2 goes once an event starts within this long, and C1 no longer does. */
const READY_MS = 7 * DAY_MS;
/** C4 goes this long before a draft contest's picks close. */
const NOT_OPEN_MS = 48 * HOUR_MS;
/** A contest created this recently is being set up right now; C4 leaves its commissioner alone. */
const JUST_CREATED_MS = 6 * HOUR_MS;

/** The events C1 and C2 are about: not yet started, and not called off or on hold. */
const UPCOMING_STATUSES: readonly SportEventStatus[] = [SportEventStatus.DRAFT, SportEventStatus.SCHEDULED];

export interface CommissionerNoticeDeps extends LeagueMemberDeps, Pick<ContestSummaryDeps, 'matches'> {
  sportEvents: Pick<SportEventRepository, 'findAll' | 'findByIds' | 'countParticipants'>;
  contests: Pick<ContestRepository, 'findBySportEvent' | 'findByStatuses'>;
  /** A draft contest's rules, for when its picks close. */
  configurations: Pick<ContestConfigurationRepository, 'findByContest'>;
  /** The default contest setups offered on an event. */
  templates: Pick<ContestConfigTemplateRepository, 'list'>;
  leagues: Pick<LeagueRepository, 'findById' | 'findAll'>;
  /** Last year's contests' winners. */
  finalStandings: Pick<ContestService, 'finalStandingsOf'>;
  email: Pick<EmailService, 'send' | 'leaguesRecorded' | 'hasRecordedForContest'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}

/** Which event email is due: C1 while the event is more than 7 days out, then C2 once released. */
type EventNoticeKey = 'EVENT_COMING_UP' | 'EVENT_READY_FOR_CONTESTS';

/** The event email due for `sportEvent` now, or null. */
function dueEventNotice(sportEvent: SportEvent, now: Date): EventNoticeKey | null {
  if (!UPCOMING_STATUSES.includes(sportEvent.status)) return null;
  const startsIn = sportEvent.startDate.getTime() - now.getTime();
  if (startsIn <= 0 || startsIn > COMING_UP_MS) return null;
  if (startsIn > READY_MS) return 'EVENT_COMING_UP';
  return sportEvent.status === SportEventStatus.SCHEDULED ? 'EVENT_READY_FOR_CONTESTS' : null;
}

export class CommissionerNotices implements DueNotifications {
  constructor(private readonly deps: CommissionerNoticeDeps) {}

  async queueDue(now: Date): Promise<void> {
    const commissioners = new Map<string, Promise<User[]>>();
    const commissionersOf = (leagueId: string): Promise<User[]> => {
      const known = commissioners.get(leagueId);
      if (known) return known;
      const found = activeLeagueMembersWithRoles(this.deps, leagueId)
        .then((members) => members.filter(({ role }) => role === LeagueRole.COMMISSIONER).map(({ user }) => user));
      commissioners.set(leagueId, found);
      return found;
    };
    await this.queueEventNotices(now, commissionersOf);
    await this.queueContestsNotOpen(now, commissionersOf);
  }

  /** C1 and C2, for every event starting within 10 days. */
  private async queueEventNotices(now: Date, commissionersOf: (leagueId: string) => Promise<User[]>): Promise<void> {
    const sportEvents = await this.deps.sportEvents.findAll({
      startsFrom: now,
      startsBefore: new Date(now.getTime() + COMING_UP_MS),
    });
    let leagues: League[] | undefined;
    const firstWeeks = new Map<string, Promise<string | undefined>>();
    for (const sportEvent of sportEvents) {
      const templateKey = dueEventNotice(sportEvent, now);
      if (templateKey === null) continue;
      try {
        if (contestTemplateEventTypeOf(sportEvent) === ContestTemplateEventType.WEEK) {
          const season = `${sportEvent.sportLeagueId}:${sportEvent.eventYear}`;
          const firstWeek = firstWeeks.get(season) ?? this.firstWeekOf(sportEvent);
          firstWeeks.set(season, firstWeek);
          if (await firstWeek !== sportEvent.id) continue;
        }
        const told = await this.deps.email.leaguesRecorded(templateKey, sportEvent.id);
        leagues ??= await this.deps.leagues.findAll({ isActive: true });
        let untold = leagues.filter((league) => !told.has(league.id) && !league.mutedSportLeagueIds.includes(sportEvent.sportLeagueId));
        if (templateKey === 'EVENT_READY_FOR_CONTESTS') {
          const withContest = new Set((await this.deps.contests.findBySportEvent(sportEvent.id)).map((contest) => contest.leagueId));
          untold = untold.filter((league) => !withContest.has(league.id));
        }
        if (untold.length === 0) continue;
        if (templateKey === 'EVENT_COMING_UP') {
          await this.sendComingUp(sportEvent, untold, commissionersOf);
        } else {
          await this.sendReadyForContests(sportEvent, untold, commissionersOf);
        }
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.commissionerEventNotices.failed',
          data: { sportEventId: sportEvent.id, templateKey, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue commissioner emails for an event');
      }
    }
  }

  /** The id of the first week of `sportEvent`'s season in its sport league. */
  private async firstWeekOf(sportEvent: SportEvent): Promise<string | undefined> {
    const season = await this.deps.sportEvents.findAll({ sportLeagueId: sportEvent.sportLeagueId, eventYear: sportEvent.eventYear });
    return season
      .filter((week) => week.status !== SportEventStatus.CANCELLED
        && contestTemplateEventTypeOf(week) === ContestTemplateEventType.WEEK)
      .reduce<SportEvent | undefined>((first, week) => (first === undefined || week.startDate < first.startDate ? week : first), undefined)
      ?.id;
  }

  /** C1: the event's dates, and each league's contests on last year's edition with their winners. */
  private async sendComingUp(
    sportEvent: SportEvent,
    leagues: League[],
    commissionersOf: (leagueId: string) => Promise<User[]>,
  ): Promise<void> {
    const lastYear = await this.lastYearWinners(sportEvent, new Set(leagues.map((league) => league.id)));
    for (const league of leagues) {
      const contestsUrl = buildLeagueAdminContestsUrl(this.deps.appBaseUrl, league.leagueCode);
      for (const user of await commissionersOf(league.id)) {
        await this.deps.email.send('EVENT_COMING_UP', {
          to: { email: user.email, userId: user.id, timeZone: user.timezone },
          about: `${sportEvent.id}:${league.id}`,
          league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
          data: {
            userName: formatUserName(user),
            leagueName: league.name,
            eventName: sportEvent.name,
            startsAt: sportEvent.startDate,
            released: sportEvent.status !== SportEventStatus.DRAFT,
            lastYear: lastYear.get(league.id) ?? [],
            contestsUrl,
          },
        });
      }
    }
  }

  /** Each of `leagueIds`' settled one-event contests on the event's previous edition, with their winners. */
  private async lastYearWinners(sportEvent: SportEvent, leagueIds: Set<string>): Promise<Map<string, PreviousContestWinners[]>> {
    const previous = (await this.deps.sportEvents.findAll({ sportLeagueId: sportEvent.sportLeagueId, eventYear: sportEvent.eventYear - 1 }))
      .find((candidate) => candidate.eventSeriesId === sportEvent.eventSeriesId);
    const byLeague = new Map<string, PreviousContestWinners[]>();
    if (!previous) return byLeague;
    const contests = (await this.deps.contests.findBySportEvent(previous.id, { statuses: [ContestStatus.COMPLETED] }))
      // A season contest that included the edition didn't make anyone its winner.
      .filter((contest) => leagueIds.has(contest.leagueId) && contest.sportEventIds.length === 1);
    for (const contest of contests) {
      const winners = (await this.deps.finalStandings.finalStandingsOf(contest)).entries
        .filter((entry) => entry.position === 1)
        .map((entry) => entry.entryName);
      if (winners.length === 0) continue;
      byLeague.set(contest.leagueId, [...(byLeague.get(contest.leagueId) ?? []), { contestName: contest.name, winners }]);
    }
    return byLeague;
  }

  /** C2: the start, the field and the default contest setups offered on the event. */
  private async sendReadyForContests(
    sportEvent: SportEvent,
    leagues: League[],
    commissionersOf: (leagueId: string) => Promise<User[]>,
  ): Promise<void> {
    const [fieldSizes, templates] = await Promise.all([
      this.deps.sportEvents.countParticipants([sportEvent.id]),
      this.deps.templates.list({ sport: sportEvent.sport, active: true }),
    ]);
    const fieldSize = fieldSizes.get(sportEvent.id) ?? 0;
    const field = fieldSize > 0 ? countParticipants(fieldSize, getSportDefinition(sportEvent.sport).vocabulary.participant) : null;
    const defaults = templates.filter((template) => template.isDefault && isTemplateOfferedOn(template, sportEvent));
    for (const league of leagues) {
      const setups: ContestSetupLink[] = defaults.map((template) => ({
        name: template.name,
        url: buildCreateContestUrl(this.deps.appBaseUrl, league.leagueCode, template.id),
      }));
      const createContestUrl = buildCreateContestUrl(this.deps.appBaseUrl, league.leagueCode);
      for (const user of await commissionersOf(league.id)) {
        await this.deps.email.send('EVENT_READY_FOR_CONTESTS', {
          to: { email: user.email, userId: user.id, timeZone: user.timezone },
          about: `${sportEvent.id}:${league.id}`,
          league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
          data: {
            userName: formatUserName(user),
            leagueName: league.name,
            eventName: sportEvent.name,
            startsAt: sportEvent.startDate,
            field,
            setups,
            createContestUrl,
          },
        });
      }
    }
  }

  /** C4, for every draft contest whose picks close within 48 hours. */
  private async queueContestsNotOpen(now: Date, commissionersOf: (leagueId: string) => Promise<User[]>): Promise<void> {
    const drafts = (await this.deps.contests.findByStatuses([ContestStatus.DRAFT]))
      .filter((contest) => now.getTime() - contest.createdAt.getTime() >= JUST_CREATED_MS);
    if (drafts.length === 0) return;
    const sportEvents = new Map((await this.deps.sportEvents.findByIds(
      [...new Set(drafts.flatMap((contest) => contest.sportEventIds.slice(0, 1)))],
    )).map((sportEvent) => [sportEvent.id, sportEvent]));
    for (const contest of drafts) {
      try {
        const first = sportEvents.get(contest.sportEventIds[0] ?? '');
        // Picks never close before the first event starts, so one starting later than 48 hours
        // from now has nothing due yet.
        if (!first || !UPCOMING_STATUSES.includes(first.status) || first.startDate.getTime() - now.getTime() > NOT_OPEN_MS) continue;
        await this.queueContestNotOpen(contest, first, now, commissionersOf);
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.contestNotOpen.failed',
          data: { contestId: contest.id, leagueId: contest.leagueId, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue the contest not open email');
      }
    }
  }

  private async queueContestNotOpen(
    contest: Contest,
    first: SportEvent,
    now: Date,
    commissionersOf: (leagueId: string) => Promise<User[]>,
  ): Promise<void> {
    const rules = (await this.deps.configurations.findByContest(contest.id))?.configJson;
    if (!rules) return;
    const closesAt = await contestClosesAt(this.deps, contest, rules, first);
    const closesIn = closesAt.getTime() - now.getTime();
    if (closesIn <= 0 || closesIn > NOT_OPEN_MS) return;
    if (await this.deps.email.hasRecordedForContest('CONTEST_NOT_OPEN', contest.id, contest.id)) return;
    const league = await this.deps.leagues.findById(contest.leagueId);
    if (!league?.isActive) return;
    const contestAdminUrl = buildContestAdminUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
    for (const user of await commissionersOf(league.id)) {
      await this.deps.email.send('CONTEST_NOT_OPEN', {
        to: { email: user.email, userId: user.id, timeZone: user.timezone },
        about: contest.id,
        league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
        refs: { contestId: contest.id },
        data: {
          userName: formatUserName(user),
          leagueName: league.name,
          contestName: contest.name,
          closesAt,
          contestAdminUrl,
        },
      });
    }
  }
}
