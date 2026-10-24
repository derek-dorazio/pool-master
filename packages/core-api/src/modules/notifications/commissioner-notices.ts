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
 * A league whose commissioners chose the weekly digest (#851) gets neither C1 nor C2. Instead its
 * commissioners get one email on Monday, every league's at the same hour in US Eastern time
 * (EMAIL_CONFIG.weeklyDigestHour, 3am by default, so it is waiting in the morning), listing the
 * events of the next two weeks the league would have heard about, by week, with whether the league
 * has a contest on each. A week with nothing coming up sends nothing.
 *
 * The lifecycle scheduler's "notifications due" step calls `queueDue` on every sweep. Each email
 * is queued once: its outbox idempotency key is the event and league (C1, C2), the contest (C4)
 * or the Monday and the league (the digest) and the person, and a league or contest already told is skipped before any work. So if a
 * send fails partway through a league's commissioners, the rest of that league is not told.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestRepository,
  LeagueRepository,
  SportEventRepository,
  SportLeagueRepository,
} from '@poolmaster/shared/db';
import {
  ContestStatus,
  ContestTemplateEventType,
  EventEmailDelivery,
  LeagueRole,
  SportEventStatus,
  contestTemplateEventTypeOf,
  countParticipants,
  eventSportDefinition,
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
  DigestEventState,
  formatUserName,
  type ContestSetupLink,
  type EmailService,
  type PreviousContestWinners,
  type WeeklyDigestEvent,
} from '../email';
import type { DueNotifications } from '../events/event-lifecycle-scheduler';
import type { EmailConfig } from '@poolmaster/shared/dto';
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
/** The digest lists the events starting within this long, the first 7 days as "This week". */
const DIGEST_WINDOW_MS = 14 * DAY_MS;
const DIGEST_WEEK_MS = 7 * DAY_MS;
/** The digest's hour (EMAIL_CONFIG.weeklyDigestHour) is in this zone, so it follows daylight saving. */
const DIGEST_TIME_ZONE = 'America/New_York';

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
  /** The digest names each event's sport league. */
  sportLeagues: Pick<SportLeagueRepository, 'findById'>;
  readConfig: () => Pick<EmailConfig, 'weeklyDigestHour'>;
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

/** Monday's date in US Eastern time, as YYYY-MM-DD, once its digest hour has come; otherwise null. */
function digestMondayOf(now: Date, digestHour: number): string | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DIGEST_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? '';
  if (part('weekday') !== 'Mon' || Number(part('hour')) < digestHour) return null;
  return `${part('year')}-${part('month')}-${part('day')}`;
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
    const firstWeeks = new Map<string, Promise<string | undefined>>();
    await this.queueEventNotices(now, commissionersOf, firstWeeks);
    await this.queueWeeklyDigests(now, commissionersOf, firstWeeks);
    await this.queueContestsNotOpen(now, commissionersOf);
  }

  /** C1 and C2, for every event starting within 10 days. */
  private async queueEventNotices(
    now: Date,
    commissionersOf: (leagueId: string) => Promise<User[]>,
    firstWeeks: Map<string, Promise<string | undefined>>,
  ): Promise<void> {
    const sportEvents = await this.deps.sportEvents.findAll({
      startsFrom: now,
      startsBefore: new Date(now.getTime() + COMING_UP_MS),
    });
    let leagues: League[] | undefined;
    for (const sportEvent of sportEvents) {
      const templateKey = dueEventNotice(sportEvent, now);
      if (templateKey === null) continue;
      try {
        if (!await this.isToldOf(sportEvent, firstWeeks)) continue;
        const told = await this.deps.email.leaguesRecorded(templateKey, sportEvent.id);
        leagues ??= (await this.deps.leagues.findAll({ isActive: true }))
          .filter((league) => league.eventEmailDelivery === EventEmailDelivery.PER_EVENT);
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

  /** False for a later week of a season whose events are weeks: only its first week is told of. */
  private async isToldOf(sportEvent: SportEvent, firstWeeks: Map<string, Promise<string | undefined>>): Promise<boolean> {
    if (contestTemplateEventTypeOf(sportEvent) !== ContestTemplateEventType.WEEK) return true;
    const season = `${sportEvent.sportLeagueId}:${sportEvent.eventYear}`;
    const firstWeek = firstWeeks.get(season) ?? this.firstWeekOf(sportEvent);
    firstWeeks.set(season, firstWeek);
    return await firstWeek === sportEvent.id;
  }

  /** The digest, for each league that chose it and hasn't had this week's, once Monday's digest hour has come. */
  private async queueWeeklyDigests(
    now: Date,
    commissionersOf: (leagueId: string) => Promise<User[]>,
    firstWeeks: Map<string, Promise<string | undefined>>,
  ): Promise<void> {
    const monday = digestMondayOf(now, this.deps.readConfig().weeklyDigestHour);
    if (monday === null) return;
    const told = await this.deps.email.leaguesRecorded('EVENT_WEEKLY_DIGEST', monday);
    const due = (await this.deps.leagues.findAll({ isActive: true }))
      .filter((league) => league.eventEmailDelivery === EventEmailDelivery.WEEKLY_DIGEST && !told.has(league.id));
    if (due.length === 0) return;

    const upcoming: SportEvent[] = [];
    for (const sportEvent of await this.deps.sportEvents.findAll({ startsFrom: now, startsBefore: new Date(now.getTime() + DIGEST_WINDOW_MS) })) {
      if (sportEvent.startDate > now && UPCOMING_STATUSES.includes(sportEvent.status) && await this.isToldOf(sportEvent, firstWeeks)) {
        upcoming.push(sportEvent);
      }
    }
    upcoming.sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
    const contestLeagues = new Map<string, Set<string>>();
    const sportLeagueNames = new Map<string, string>();
    for (const sportEvent of upcoming) {
      contestLeagues.set(sportEvent.id, new Set((await this.deps.contests.findBySportEvent(sportEvent.id)).map((contest) => contest.leagueId)));
      if (!sportLeagueNames.has(sportEvent.sportLeagueId)) {
        sportLeagueNames.set(sportEvent.sportLeagueId, (await this.deps.sportLeagues.findById(sportEvent.sportLeagueId))?.name ?? '');
      }
    }

    const nextWeekFrom = now.getTime() + DIGEST_WEEK_MS;
    for (const league of due) {
      try {
        const createContestUrl = buildCreateContestUrl(this.deps.appBaseUrl, league.leagueCode);
        const listed = upcoming
          .filter((sportEvent) => !league.mutedSportLeagueIds.includes(sportEvent.sportLeagueId))
          .map((sportEvent): WeeklyDigestEvent => {
            const base = { eventName: sportEvent.name, sportLeagueName: sportLeagueNames.get(sportEvent.sportLeagueId) ?? '', startsAt: sportEvent.startDate };
            if (contestLeagues.get(sportEvent.id)?.has(league.id)) return { ...base, state: DigestEventState.CONTEST_SET_UP };
            return sportEvent.status === SportEventStatus.SCHEDULED
              ? { ...base, state: DigestEventState.READY, createContestUrl }
              : { ...base, state: DigestEventState.NOT_READY };
          });
        if (listed.length === 0) continue;
        const thisWeek = listed.filter((listedEvent) => listedEvent.startsAt.getTime() < nextWeekFrom);
        const nextWeek = listed.filter((listedEvent) => listedEvent.startsAt.getTime() >= nextWeekFrom);
        const contestsUrl = buildLeagueAdminContestsUrl(this.deps.appBaseUrl, league.leagueCode);
        for (const user of await commissionersOf(league.id)) {
          await this.deps.email.send('EVENT_WEEKLY_DIGEST', {
            to: { email: user.email, userId: user.id, timeZone: user.timezone },
            about: `${monday}:${league.id}`,
            league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
            data: { userName: formatUserName(user), leagueName: league.name, thisWeek, nextWeek, contestsUrl },
          });
        }
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.weeklyDigest.failed',
          data: { leagueId: league.id, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue the weekly event digest');
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
    const field = fieldSize > 0 ? countParticipants(fieldSize, eventSportDefinition(sportEvent).vocabulary.participant) : null;
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
