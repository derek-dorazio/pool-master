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
  ContestEntryStandingRepository,
  ContestRepository,
  LeagueRepository,
  SportEventMatchRepository,
  SportEventRepository,
  SportLeagueRepository,
} from '@poolmaster/shared/db';
import {
  ContestStatus,
  ContestTemplateEventType,
  EventEmailDelivery,
  SportEventStatus,
  contestTemplateEventTypeOf,
  countParticipants,
  eventSportDefinition,
  formatSelectionTypeName,
  isTemplateOfferedOn,
  type Contest,
  type ContestConfigTemplate,
  type EventPage,
  type League,
  type SportEvent,
  type SportEventMatch,
  type User,
} from '@poolmaster/shared/domain';
import type { EventPageService } from '../event-pages/service';
import {
  emailRecipientOf,
  buildContestAdminUrl,
  buildCreateContestUrl,
  buildEmailEventHeader,
  buildEmailFormatImageUrl,
  buildEmailSportImageUrl,
  buildEventPageUrl,
  buildLeagueAdminContestsUrl,
  buildLeagueContestTypesUrl,
  DigestEventState,
  formatUserName,
  type ContestSetupTile,
  type EmailEventHeader,
  type EmailService,
  type PreviousContestWinners,
  type WeeklyDigestEvent,
} from '../email';
import type { DueNotifications } from '../events/event-lifecycle-scheduler';
import type { EmailConfig } from '@poolmaster/shared/dto';
import { closesOnAGame, contestClosesAtGiven } from './contest-summary';
import { activeCommissionersByLeague, type LeagueMemberDeps } from './league-members';

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

export interface CommissionerNoticeDeps extends LeagueMemberDeps {
  /** A draft contest's first event's games, for a contest whose picks close at one of them. */
  matches: Pick<SportEventMatchRepository, 'findBySportEvents'>;
  sportEvents: Pick<SportEventRepository, 'findAll' | 'findByIds' | 'countParticipants'>;
  contests: Pick<ContestRepository, 'findBySportEvent' | 'findBySportEvents' | 'findByStatuses'>;
  /** A draft contest's rules, for when its picks close. */
  configurations: Pick<ContestConfigurationRepository, 'findByContests'>;
  /** The default contest setups offered on an event. */
  templates: Pick<ContestConfigTemplateRepository, 'list'>;
  leagues: Pick<LeagueRepository, 'findByIds' | 'findActive'>;
  /** C1, C2 and the digest name each event's sport league. */
  sportLeagues: Pick<SportLeagueRepository, 'findById' | 'findByIds'>;
  readConfig: () => Pick<EmailConfig, 'weeklyDigestHour'>;
  /** The event page offering each event, which C1, C2 and the digest link to. */
  eventPages: Pick<EventPageService, 'pagesByEvent'>;
  /** Last year's contests' winners. */
  standings: Pick<ContestEntryStandingRepository, 'findWinnersByContests'>;
  email: Pick<EmailService, 'send' | 'leaguesRecordedAbout'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}

/** By event, the leagues with one of `contests` on it. */
function leagueIdsByEvent(contests: readonly Contest[]): Map<string, Set<string>> {
  const byEvent = new Map<string, Set<string>>();
  for (const contest of contests) {
    for (const sportEventId of contest.sportEventIds) byEvent.set(sportEventId, (byEvent.get(sportEventId) ?? new Set<string>()).add(contest.leagueId));
  }
  return byEvent;
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

/** Each league's commissioners, read for many leagues at once and remembered for the run (#1255). */
class LeagueCommissioners {
  private readonly known = new Map<string, Promise<User[]>>();

  constructor(private readonly deps: LeagueMemberDeps) {}

  /** Reads the commissioners of every league named that is not read yet, in one read of each kind. */
  async load(leagueIds: readonly string[]): Promise<void> {
    const missing = [...new Set(leagueIds)].filter((leagueId) => !this.known.has(leagueId));
    if (missing.length === 0) return;
    const read = activeCommissionersByLeague(this.deps, missing);
    for (const leagueId of missing) this.known.set(leagueId, read.then((byLeague) => byLeague.get(leagueId) ?? []));
    await read;
  }

  async of(leagueId: string): Promise<User[]> {
    await this.load([leagueId]);
    return await this.known.get(leagueId) ?? [];
  }
}

export class CommissionerNotices implements DueNotifications {
  constructor(private readonly deps: CommissionerNoticeDeps) {}

  async queueDue(now: Date): Promise<void> {
    const commissioners = new LeagueCommissioners(this.deps);
    const firstWeeks = new Map<string, Promise<string | undefined>>();
    // Read once a run, and only when an email is due.
    let pages: Promise<Map<string, EventPage>> | undefined;
    const eventPages = (): Promise<Map<string, EventPage>> => (pages ??= this.deps.eventPages.pagesByEvent());
    await this.queueEventNotices(now, commissioners, firstWeeks, eventPages);
    await this.queueWeeklyDigests(now, commissioners, firstWeeks, eventPages);
    await this.queueContestsNotOpen(now, commissioners);
  }

  /** C1 and C2, for every event starting within 10 days. */
  private async queueEventNotices(
    now: Date,
    commissioners: LeagueCommissioners,
    firstWeeks: Map<string, Promise<string | undefined>>,
    eventPages: () => Promise<Map<string, EventPage>>,
  ): Promise<void> {
    const sportEvents = await this.deps.sportEvents.findAll({
      startsFrom: now,
      startsBefore: new Date(now.getTime() + COMING_UP_MS),
    });
    const due = sportEvents.flatMap((sportEvent) => {
      const templateKey = dueEventNotice(sportEvent, now);
      return templateKey === null ? [] : [{ sportEvent, templateKey }];
    });
    if (due.length === 0) return;
    // The leagues told of each due event, and the leagues with a contest on each event ready for
    // contests, are read once for the run, not once per event (#1255).
    const readyIds = due.filter(({ templateKey }) => templateKey === 'EVENT_READY_FOR_CONTESTS').map(({ sportEvent }) => sportEvent.id);
    const [toldComingUp, toldReady] = await Promise.all([
      this.deps.email.leaguesRecordedAbout('EVENT_COMING_UP', due.filter(({ templateKey }) => templateKey === 'EVENT_COMING_UP').map(({ sportEvent }) => sportEvent.id)),
      this.deps.email.leaguesRecordedAbout('EVENT_READY_FOR_CONTESTS', readyIds),
    ]);
    const leagues = (await this.deps.leagues.findActive())
      .filter((league) => league.eventEmailDelivery === EventEmailDelivery.PER_EVENT);
    if (leagues.length === 0) return;
    // Read at the first ready event a league is still to be told of, for every ready event.
    let leagueIdsWithContest: Promise<Map<string, Set<string>>> | undefined;
    const sends: Array<{ sportEvent: SportEvent; templateKey: EventNoticeKey; untold: League[] }> = [];
    for (const { sportEvent, templateKey } of due) {
      try {
        if (!await this.isToldOf(sportEvent, firstWeeks)) continue;
        const told = (templateKey === 'EVENT_COMING_UP' ? toldComingUp : toldReady).get(sportEvent.id) ?? new Set<string>();
        let untold = leagues.filter((league) => !told.has(league.id) && !league.mutedSportLeagueIds.includes(sportEvent.sportLeagueId));
        if (templateKey === 'EVENT_READY_FOR_CONTESTS' && untold.length > 0) {
          leagueIdsWithContest ??= this.deps.contests.findBySportEvents(readyIds).then(leagueIdsByEvent);
          const withContest = (await leagueIdsWithContest).get(sportEvent.id);
          untold = untold.filter((league) => !withContest?.has(league.id));
        }
        if (untold.length > 0) sends.push({ sportEvent, templateKey, untold });
      } catch (error) {
        this.failedEventNotices(sportEvent, templateKey, error);
      }
    }
    if (sends.length === 0) return;
    // The commissioners of every league still to be told of any event are read once for the run,
    // and not at all once every league has been told (#1255).
    await commissioners.load(sends.flatMap(({ untold }) => untold.map((league) => league.id)));
    for (const { sportEvent, templateKey, untold } of sends) {
      try {
        if (templateKey === 'EVENT_COMING_UP') {
          await this.sendComingUp(sportEvent, untold, commissioners, await eventPages());
        } else {
          await this.sendReadyForContests(sportEvent, untold, commissioners, await eventPages());
        }
      } catch (error) {
        this.failedEventNotices(sportEvent, templateKey, error);
      }
    }
  }

  private failedEventNotices(sportEvent: SportEvent, templateKey: EventNoticeKey, error: unknown): void {
    this.deps.logger?.error({
      action: 'email.commissionerEventNotices.failed',
      data: { sportEventId: sportEvent.id, templateKey, error: error instanceof Error ? error.message : String(error) },
    }, 'Failed to queue commissioner emails for an event');
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
    commissioners: LeagueCommissioners,
    firstWeeks: Map<string, Promise<string | undefined>>,
    eventPages: () => Promise<Map<string, EventPage>>,
  ): Promise<void> {
    const monday = digestMondayOf(now, this.deps.readConfig().weeklyDigestHour);
    if (monday === null) return;
    const told = (await this.deps.email.leaguesRecordedAbout('EVENT_WEEKLY_DIGEST', [monday])).get(monday) ?? new Set<string>();
    const due = (await this.deps.leagues.findActive())
      .filter((league) => league.eventEmailDelivery === EventEmailDelivery.WEEKLY_DIGEST && !told.has(league.id));
    if (due.length === 0) return;

    const upcoming: SportEvent[] = [];
    for (const sportEvent of await this.deps.sportEvents.findAll({ startsFrom: now, startsBefore: new Date(now.getTime() + DIGEST_WINDOW_MS) })) {
      if (sportEvent.startDate > now && UPCOMING_STATUSES.includes(sportEvent.status) && await this.isToldOf(sportEvent, firstWeeks)) {
        upcoming.push(sportEvent);
      }
    }
    upcoming.sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
    // Every upcoming event's contests in one read, not one per event (#1255).
    const contestLeagues = leagueIdsByEvent(upcoming.length === 0 ? [] : await this.deps.contests.findBySportEvents(upcoming.map((sportEvent) => sportEvent.id)));
    const sportLeagueIds = [...new Set(upcoming.map((sportEvent) => sportEvent.sportLeagueId))];
    const sportLeagueNames = new Map((sportLeagueIds.length === 0 ? [] : await this.deps.sportLeagues.findByIds(sportLeagueIds))
      .map((sportLeague) => [sportLeague.id, sportLeague.name]));

    const pages = await eventPages();
    const nextWeekFrom = now.getTime() + DIGEST_WEEK_MS;
    await commissioners.load(due.map((league) => league.id));
    for (const league of due) {
      try {
        const listed = upcoming
          .filter((sportEvent) => !league.mutedSportLeagueIds.includes(sportEvent.sportLeagueId))
          .map((sportEvent): WeeklyDigestEvent => {
            const base = {
              eventName: sportEvent.name,
              sportLeagueName: sportLeagueNames.get(sportEvent.sportLeagueId) ?? '',
              startsAt: sportEvent.startDate,
              imageUrl: buildEmailSportImageUrl(this.deps.appBaseUrl, sportEvent.sport),
              eventPageUrl: this.eventPageUrl(pages, sportEvent),
            };
            if (contestLeagues.get(sportEvent.id)?.has(league.id)) return { ...base, state: DigestEventState.CONTEST_SET_UP };
            return sportEvent.status === SportEventStatus.SCHEDULED
              ? { ...base, state: DigestEventState.READY, createContestUrl: buildCreateContestUrl(this.deps.appBaseUrl, league.leagueCode, { sportEventId: sportEvent.id }) }
              : { ...base, state: DigestEventState.NOT_READY };
          });
        if (listed.length === 0) continue;
        const thisWeek = listed.filter((listedEvent) => listedEvent.startsAt.getTime() < nextWeekFrom);
        const nextWeek = listed.filter((listedEvent) => listedEvent.startsAt.getTime() >= nextWeekFrom);
        const contestsUrl = buildLeagueAdminContestsUrl(this.deps.appBaseUrl, league.leagueCode);
        for (const user of await commissioners.of(league.id)) {
          await this.deps.email.send('EVENT_WEEKLY_DIGEST', {
            to: emailRecipientOf(user),
            about: `${monday}:${league.id}`,
            noticeAbout: monday,
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

  /** C1: the event, the ways to play it, and each league's contests on last year's edition with their winners. */
  private async sendComingUp(
    sportEvent: SportEvent,
    leagues: League[],
    commissioners: LeagueCommissioners,
    pages: Map<string, EventPage>,
  ): Promise<void> {
    const [event, defaults, lastYear] = await Promise.all([
      this.eventHeader(sportEvent),
      this.defaultSetupsOn(sportEvent),
      this.lastYearWinners(sportEvent, new Set(leagues.map((league) => league.id))),
    ]);
    const eventPageUrl = this.eventPageUrl(pages, sportEvent);
    for (const league of leagues) {
      const contestsUrl = buildLeagueAdminContestsUrl(this.deps.appBaseUrl, league.leagueCode);
      // The event may not be released yet, so a tile explains the way to play rather than starting
      // one: on the event's page when it has one, else on the league's contest types page.
      const howItWorksUrl = eventPageUrl ?? buildLeagueContestTypesUrl(this.deps.appBaseUrl, league.leagueCode);
      const setups = defaults.map((template) => this.setupTile(template, howItWorksUrl));
      for (const user of await commissioners.of(league.id)) {
        await this.deps.email.send('EVENT_COMING_UP', {
          to: emailRecipientOf(user),
          about: `${sportEvent.id}:${league.id}`,
          noticeAbout: sportEvent.id,
          league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
          data: {
            userName: formatUserName(user),
            leagueName: league.name,
            event,
            released: sportEvent.status !== SportEventStatus.DRAFT,
            setups,
            lastYear: lastYear.get(league.id) ?? [],
            contestsUrl,
          },
        });
      }
    }
  }

  /** The top of an email about `sportEvent`: its sport's picture, sport league, name and start. */
  private async eventHeader(sportEvent: SportEvent): Promise<EmailEventHeader> {
    const sportLeagueName = (await this.deps.sportLeagues.findById(sportEvent.sportLeagueId))?.name ?? '';
    return buildEmailEventHeader(this.deps.appBaseUrl, sportEvent, sportLeagueName);
  }

  /** The default contest setups offered on `sportEvent`, in the order the contest types page shows them. */
  private async defaultSetupsOn(sportEvent: SportEvent): Promise<ContestConfigTemplate[]> {
    return (await this.deps.templates.list({ sport: sportEvent.sport, active: true }))
      .filter((template) => template.isDefault && isTemplateOfferedOn(template, sportEvent))
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  private eventPageUrl(pages: Map<string, EventPage>, sportEvent: SportEvent): string | null {
    const page = pages.get(sportEvent.id);
    return page ? buildEventPageUrl(this.deps.appBaseUrl, page) : null;
  }

  private setupTile(template: ContestConfigTemplate, url: string): ContestSetupTile {
    return {
      formatName: formatSelectionTypeName(template.selectionType),
      name: template.name,
      description: template.description,
      imageUrl: buildEmailFormatImageUrl(this.deps.appBaseUrl, template.selectionType),
      url,
    };
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
    if (contests.length === 0) return byLeague;
    // Every contest's winners in one read, not one per contest (#1336).
    const winnersByContest = new Map<string, string[]>();
    for (const { contestId, entryName } of await this.deps.standings.findWinnersByContests(contests.map((contest) => contest.id))) {
      winnersByContest.set(contestId, [...(winnersByContest.get(contestId) ?? []), entryName]);
    }
    for (const contest of contests) {
      const winners = winnersByContest.get(contest.id);
      if (winners === undefined) continue;
      byLeague.set(contest.leagueId, [...(byLeague.get(contest.leagueId) ?? []), { contestName: contest.name, winners }]);
    }
    return byLeague;
  }

  /** C2: the event, its field, the default contest setups offered on it and last year's winners. */
  private async sendReadyForContests(
    sportEvent: SportEvent,
    leagues: League[],
    commissioners: LeagueCommissioners,
    pages: Map<string, EventPage>,
  ): Promise<void> {
    const [fieldSizes, event, defaults, lastYear] = await Promise.all([
      this.deps.sportEvents.countParticipants([sportEvent.id]),
      this.eventHeader(sportEvent),
      this.defaultSetupsOn(sportEvent),
      this.lastYearWinners(sportEvent, new Set(leagues.map((league) => league.id))),
    ]);
    const eventPageUrl = this.eventPageUrl(pages, sportEvent);
    const fieldSize = fieldSizes.get(sportEvent.id) ?? 0;
    const field = fieldSize > 0 ? countParticipants(fieldSize, eventSportDefinition(sportEvent).vocabulary.participant) : null;
    for (const league of leagues) {
      const setups = defaults.map((template) => this.setupTile(
        template,
        buildCreateContestUrl(this.deps.appBaseUrl, league.leagueCode, { templateId: template.id, sportEventId: sportEvent.id }),
      ));
      const contestTypesUrl = buildLeagueContestTypesUrl(this.deps.appBaseUrl, league.leagueCode);
      for (const user of await commissioners.of(league.id)) {
        await this.deps.email.send('EVENT_READY_FOR_CONTESTS', {
          to: emailRecipientOf(user),
          about: `${sportEvent.id}:${league.id}`,
          noticeAbout: sportEvent.id,
          league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
          data: {
            userName: formatUserName(user),
            leagueName: league.name,
            event,
            field,
            setups,
            lastYear: lastYear.get(league.id) ?? [],
            eventPageUrl,
            contestTypesUrl,
          },
        });
      }
    }
  }

  /**
   * C4, for every draft contest whose picks close within 48 hours. The contests' rules, games,
   * told checks, leagues and commissioners are each read once for the run, not once per contest
   * (#1336).
   */
  private async queueContestsNotOpen(now: Date, commissioners: LeagueCommissioners): Promise<void> {
    const drafts = (await this.deps.contests.findByStatuses([ContestStatus.DRAFT]))
      .filter((contest) => now.getTime() - contest.createdAt.getTime() >= JUST_CREATED_MS);
    if (drafts.length === 0) return;
    const sportEvents = new Map((await this.deps.sportEvents.findByIds(
      [...new Set(drafts.flatMap((contest) => contest.sportEventIds.slice(0, 1)))],
    )).map((sportEvent) => [sportEvent.id, sportEvent]));
    // Picks never close before the first event starts, so a contest whose first event starts later
    // than 48 hours from now has nothing due yet.
    const starting = drafts.flatMap((contest) => {
      const first = sportEvents.get(contest.sportEventIds[0] ?? '');
      return first && UPCOMING_STATUSES.includes(first.status) && first.startDate.getTime() - now.getTime() <= NOT_OPEN_MS
        ? [{ contest, first }]
        : [];
    });
    if (starting.length === 0) return;
    const rulesByContest = new Map((await this.deps.configurations.findByContests(starting.map(({ contest }) => contest.id)))
      .map((configuration) => [configuration.contestId, configuration.configJson]));
    const ruled = starting.flatMap(({ contest, first }) => {
      const rules = rulesByContest.get(contest.id);
      return rules ? [{ contest, first, rules }] : [];
    });
    const onAGame = [...new Set(ruled.filter(({ contest, rules }) => closesOnAGame(contest, rules)).map(({ first }) => first.id))];
    const gamesByEvent = new Map<string, SportEventMatch[]>();
    for (const game of onAGame.length === 0 ? [] : await this.deps.matches.findBySportEvents(onAGame)) {
      gamesByEvent.set(game.sportEventId, [...(gamesByEvent.get(game.sportEventId) ?? []), game]);
    }
    const closing = ruled.flatMap(({ contest, first, rules }) => {
      const closesAt = contestClosesAtGiven(contest, rules, first, gamesByEvent.get(first.id) ?? []);
      const closesIn = closesAt.getTime() - now.getTime();
      return closesIn > 0 && closesIn <= NOT_OPEN_MS ? [{ contest, closesAt }] : [];
    });
    if (closing.length === 0) return;
    // The email is about its contest, so the one league recorded about a contest is the contest's.
    const told = await this.deps.email.leaguesRecordedAbout('CONTEST_NOT_OPEN', closing.map(({ contest }) => contest.id));
    const untold = closing.filter(({ contest }) => !told.get(contest.id)?.has(contest.leagueId));
    if (untold.length === 0) return;
    const leagues = new Map((await this.deps.leagues.findByIds([...new Set(untold.map(({ contest }) => contest.leagueId))]))
      .filter((league) => league.isActive)
      .map((league) => [league.id, league]));
    const sends = untold.flatMap(({ contest, closesAt }) => {
      const league = leagues.get(contest.leagueId);
      return league ? [{ contest, closesAt, league }] : [];
    });
    if (sends.length === 0) return;
    await commissioners.load(sends.map(({ league }) => league.id));
    for (const send of sends) {
      try {
        await this.sendContestNotOpen(send, commissioners);
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.contestNotOpen.failed',
          data: { contestId: send.contest.id, leagueId: send.contest.leagueId, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue the contest not open email');
      }
    }
  }

  private async sendContestNotOpen(
    { contest, closesAt, league }: { contest: Contest; closesAt: Date; league: League },
    commissioners: LeagueCommissioners,
  ): Promise<void> {
    const contestAdminUrl = buildContestAdminUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
    for (const user of await commissioners.of(league.id)) {
      await this.deps.email.send('CONTEST_NOT_OPEN', {
        to: emailRecipientOf(user),
        about: contest.id,
        noticeAbout: contest.id,
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
