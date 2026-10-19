import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestEntryEventStandingRepository,
  ContestEntryStandingRepository,
  ContestRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import { ContestStatus, SelectionType, SportEventStatus, SurvivorWeekOutcome, type Contest, type PickEmMode, type SportEvent } from '@poolmaster/shared/domain';
import { loadPickEmMode, loadPickEmWeekStandings, PickEmRulesMissingError } from './pick-em-standings';
import { loadSurvivorSeason, type SurvivorStandingsReadDeps } from './survivor-standings';
import {
  BracketScoringUnavailableError,
  loadBracketStandings,
  type BracketStandingsReadDeps,
} from './bracket-standings';
import {
  buildContestEntryStanding,
  buildMissedEventStanding,
  rankContestEntryStandings,
  rankContestTotals,
  resolveContestCountingRule,
  resolveContestScoringDefinition,
  type ParticipantScore,
} from './contest-leaderboard-calculator';
import {
  loadContestLeaderboardEntries,
  loadContestScoringConfiguration,
  loadEventField,
  loadMissedEventEntries,
  scoreMissedLineup,
  toParticipantScores,
} from './contest-leaderboard-reads';
import { FINISHED_EVENT_STATUSES } from './entry-window';

type LifecycleLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error' | 'fatal'>;

function createNoopLogger(): LifecycleLogger {
  const noop = () => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
}


/**
 * What settlement never touches: a contest already settled, and a DRAFT. A draft
 * leaves only by being opened or deleted (#117), so completing one would publish a contest
 * nobody could enter to the league as finished. Its event starting leaves it a draft too.
 */
const NOT_SETTLED: readonly ContestStatus[] = [ContestStatus.COMPLETED, ContestStatus.DRAFT];

/** Every status settlement may complete a contest from. */
const SETTLEABLE = Object.values(ContestStatus).filter((status) => !NOT_SETTLED.includes(status));

/*
 * A CANCELLED event counts as settled with no result for anyone (#743): it writes no standings
 * and adds nothing to any total, so a contest whose events are each completed or cancelled
 * (`FINISHED_EVENT_STATUSES`) settles on the completed ones. A contest whose every event is
 * cancelled completes with no standings.
 */

export interface ContestSettlementSummary {
  sportEventId: string;
  contestsSettled: number;
  contestsCompleted: number;
  standingsUpserted: number;
}

export interface ContestSettlementDeps extends BracketStandingsReadDeps {
  predictions: BracketStandingsReadDeps['predictions'] & SurvivorStandingsReadDeps['predictions'];
  matches: BracketStandingsReadDeps['matches'] & SurvivorStandingsReadDeps['matches'];
  sportEvents: SportEventRepository;
  contests: ContestRepository;
  standings: ContestEntryStandingRepository;
  eventStandings: ContestEntryEventStandingRepository;
  logger?: LifecycleLogger;
}

export class ContestSettlementService {
  private readonly logger: LifecycleLogger;

  constructor(private readonly deps: ContestSettlementDeps) {
    this.logger = deps.logger ?? createNoopLogger();
  }

  /** Settles the contests of a finished event: one that completed, or one that was cancelled. */
  async settleFinishedSportEvent(
    sportEventId: string,
    input?: { completedAt?: Date },
  ): Promise<ContestSettlementSummary> {
    const sportEvent = await this.deps.sportEvents.findById(sportEventId);
    if (!sportEvent || !FINISHED_EVENT_STATUSES.includes(sportEvent.status)) {
      return {
        sportEventId,
        contestsSettled: 0,
        contestsCompleted: 0,
        standingsUpserted: 0,
      };
    }

    const completedAt = input?.completedAt ?? sportEvent.endDate ?? sportEvent.startDate;
    const cancelled = sportEvent.status === SportEventStatus.CANCELLED;
    // The field is the event's, read once; each contest scores it under its own settings below.
    // A cancelled event is never scored, whatever scores it holds.
    const field = cancelled ? [] : await loadEventField(this.deps, sportEventId);
    // A COMPLETED contest is already settled: its standing is the frozen result, and re-running
    // settlement (the event re-sent as COMPLETED, or a late score correction) must not rewrite
    // it. Only a contest moved back out of COMPLETED would be settled again, and no route does
    // that today: the reopen endpoint, which nothing called, was deleted. In a contest of several
    // events (#713) each event's standings freeze the same way when that event settles, and the
    // contest itself settles when its last event does.
    const contests = await this.deps.contests.findBySportEvent(sportEventId, {
      excludeStatuses: NOT_SETTLED,
    });

    let standingsUpserted = 0;
    let contestsCompleted = 0;
    let contestsSettled = 0;
    for (const contest of contests) {
      if (contest.selectionType === SelectionType.BRACKET) {
        const settled = await this.settleBracketContest(contest, sportEvent, completedAt);
        if (settled) {
          contestsSettled++;
          standingsUpserted += settled.standingsUpserted;
          if (settled.completed) contestsCompleted++;
        }
        continue;
      }
      if (contest.selectionType === SelectionType.SURVIVOR) {
        const settled = await this.settleSurvivorWeek(contest, sportEvent, completedAt);
        contestsSettled++;
        standingsUpserted += settled.standingsUpserted;
        if (settled.completed) contestsCompleted++;
        continue;
      }
      if (contest.selectionType === SelectionType.PICK_EM) {
        const settled = await this.settlePickEmWeek(contest, sportEvent, completedAt);
        if (settled) {
          contestsSettled++;
          standingsUpserted += settled.standingsUpserted;
          if (settled.completed) contestsCompleted++;
        }
        continue;
      }
      const configuration = await loadContestScoringConfiguration(this.deps, contest.id);
      const countingRule = resolveContestCountingRule(configuration);
      if (!countingRule) {
        this.logger.error({
          contestId: contest.id,
          sportEventId,
        }, 'Skipped contest settlement because contest has no counting rule');
        continue;
      }
      const scoring = resolveContestScoringDefinition(configuration);
      if (!scoring.ok) {
        // Skip rather than guess a direction or settings. Settling with the wrong direction or
        // under rules the commissioner did not set pays the wrong entries, and a payout is hard
        // to undo; a skipped settlement is logged at error and can be run again once the
        // configuration carries a rule naming a known definition with valid settings. The
        // leaderboard read refuses the same cases with 400, because nothing is paid.
        this.logger.error({
          contestId: contest.id,
          sportEventId,
          reason: scoring.reason,
        }, 'Skipped contest settlement because its participant scoring rule is missing, names an unknown scoring definition, or carries invalid settings');
        continue;
      }
      const scoringDefinition = scoring.definition;
      // Scored per contest: a contest's settings (a points table) change its participants' scores.
      const participants = toParticipantScores(field, sportEvent, scoring.scoring);
      const scoreById = new Map(
        participants.map((participant) => [participant.sportEventParticipantId, participant]),
      );
      const asOf = resolveContestStandingAsOf(participants, completedAt);
      const settledEvents = await this.deps.eventStandings.findByContest(contest.id);
      if (!cancelled && !settledEvents.some((standing) => standing.sportEventId === sportEventId)) {
        const entries = await loadContestLeaderboardEntries(this.deps, contest.id, sportEventId);
        // In a contest of several events, an entry that missed this one is scored as a missed
        // lineup (#714) and ranked with the rest, so skipping an event never helps its total.
        const missed = await loadMissedEventEntries(this.deps, contest, new Set(entries.map((entry) => entry.id)));
        const missedScore = missed.length > 0
          ? scoreMissedLineup(field, sportEvent, scoring.scoring, countingRule.count)
          : null;
        const rankedEntries = rankContestEntryStandings(
          [
            ...entries.map((entry) =>
              buildContestEntryStanding(entry, scoreById, countingRule, scoringDefinition.direction),
            ),
            ...missed.map((entry) => buildMissedEventStanding(entry, missedScore, countingRule, scoringDefinition.direction)),
          ],
          scoringDefinition.direction,
        );
        for (const entry of rankedEntries) {
          // The single writer of ContestEntryEventStanding.
          await this.deps.eventStandings.upsert({
            contestId: contest.id,
            contestEntryId: entry.entryId,
            sportEventId,
            position: entry.position,
            displayPosition: entry.displayPosition,
            countingPickLimit: entry.countingPickLimit,
            scoredPickCount: entry.scoredPickCount,
            asOf,
            settledAt: completedAt,
            totalScore: entry.score,
          });
        }
      }
      contestsSettled++;

      if (!(await this.allEventsFinished(contest))) {
        this.logger.info({
          contestId: contest.id,
          sportEventId,
        }, 'Settled one event of a contest whose other events are still to finish');
        continue;
      }
      standingsUpserted += await this.settleContestTotals(contest, countingRule.count, scoringDefinition.direction, completedAt);

      const completed = await this.deps.contests.transitionStatus(contest.id, {
        from: SETTLEABLE,
        to: ContestStatus.COMPLETED,
        endsAt: completedAt,
      });
      if (completed) {
        contestsCompleted++;
      }
    }

    this.logger.info({
      sportEventId,
      sportEventName: sportEvent.name,
      contestsSettled,
      contestsCompleted,
      standingsUpserted,
      cancelled,
    }, 'Contest settlement completed from finished sport event');

    return {
      sportEventId,
      contestsSettled,
      contestsCompleted,
      standingsUpserted,
    };
  }

  /**
   * Settles a bracket contest (#721), which covers its one knockout event: each submitted entry's
   * points and place, frozen as both its event standing and its contest standing, then the contest
   * is COMPLETED. Answers what it wrote, or null when a bracket whose scoring rule is not knockout
   * round points is skipped and logged, as a roster contest without a usable rule is. A cancelled
   * event is its only event, so the bracket completes with no standings (#743).
   */
  private async settleBracketContest(
    contest: Contest,
    sportEvent: SportEvent,
    completedAt: Date,
  ): Promise<{ standingsUpserted: number; completed: boolean } | null> {
    const sportEventId = sportEvent.id;
    if (sportEvent.status === SportEventStatus.CANCELLED) {
      const completed = await this.deps.contests.transitionStatus(contest.id, {
        from: SETTLEABLE,
        to: ContestStatus.COMPLETED,
        endsAt: completedAt,
      });
      this.logger.info({ contestId: contest.id, sportEventId, completed }, 'Completed a bracket contest whose event was cancelled, with no standings');
      return { standingsUpserted: 0, completed };
    }
    let standings: Awaited<ReturnType<typeof loadBracketStandings>>;
    try {
      standings = await loadBracketStandings(this.deps, contest.id, sportEvent);
    } catch (error) {
      if (!(error instanceof BracketScoringUnavailableError)) throw error;
      this.logger.error({ contestId: contest.id, sportEventId, reason: error.reason }, 'Skipped bracket contest settlement because it cannot be scored');
      return null;
    }
    for (const standing of standings.entries) {
      const frozen = {
        contestId: contest.id,
        contestEntryId: standing.entry.id,
        position: standing.position,
        displayPosition: standing.displayPosition,
        // A bracket counts every pick: the limit is its game count, and a pick is scored once decided.
        countingPickLimit: standings.gameCount,
        scoredPickCount: standing.score.decidedPickCount,
        asOf: completedAt,
        settledAt: completedAt,
        totalScore: standing.score.points,
      };
      await this.deps.eventStandings.upsert({ ...frozen, sportEventId });
      await this.deps.standings.upsert(frozen);
    }
    const completed = await this.deps.contests.transitionStatus(contest.id, {
      from: SETTLEABLE,
      to: ContestStatus.COMPLETED,
      endsAt: completedAt,
    });
    this.logger.info({ contestId: contest.id, sportEventId, entryCount: standings.entries.length, completed }, 'Settled a bracket contest');
    return { standingsUpserted: standings.entries.length, completed };
  }

  /**
   * Settles one week of a pick'em contest (#717): each submitted entry's points and place for the
   * week, frozen as its event standing, where place 1 is the week's winner. A week settles once:
   * a result corrected after it changes nothing. When the contest's last week settles, the season
   * totals are summed and ranked into contest standings and the contest is COMPLETED. A cancelled
   * week counts for nothing (#743). Answers what it wrote, or null when the contest's rules are not
   * pick'em rules, which is skipped and logged.
   */
  private async settlePickEmWeek(
    contest: Contest,
    sportEvent: SportEvent,
    completedAt: Date,
  ): Promise<{ standingsUpserted: number; completed: boolean } | null> {
    const sportEventId = sportEvent.id;
    let mode: PickEmMode;
    try {
      mode = await loadPickEmMode(this.deps, contest.id);
    } catch (error) {
      if (!(error instanceof PickEmRulesMissingError)) throw error;
      this.logger.error({ contestId: contest.id, sportEventId }, 'Skipped pick\'em settlement because the contest carries no pick\'em rules');
      return null;
    }
    const settledWeeks = await this.deps.eventStandings.findByContest(contest.id);
    if (sportEvent.status !== SportEventStatus.CANCELLED && !settledWeeks.some((standing) => standing.sportEventId === sportEventId)) {
      const week = await loadPickEmWeekStandings(this.deps, contest.id, sportEvent, mode);
      for (const standing of week.entries) {
        await this.deps.eventStandings.upsert({
          contestId: contest.id,
          contestEntryId: standing.entry.id,
          sportEventId,
          position: standing.position,
          displayPosition: standing.displayPosition,
          // Every pick of the week counts: the limit is its game count, and a pick is scored once decided.
          countingPickLimit: week.gameCount,
          scoredPickCount: standing.score.decidedPickCount,
          asOf: completedAt,
          settledAt: completedAt,
          totalScore: standing.score.points,
        });
      }
      this.logger.info({ contestId: contest.id, sportEventId, entryCount: week.entries.length }, 'Settled one week of a pick\'em contest');
    }
    if (!(await this.allEventsFinished(contest))) {
      return { standingsUpserted: 0, completed: false };
    }
    const weeks = await this.deps.eventStandings.findByContest(contest.id);
    // The season counts every game of its settled weeks.
    const gameCountByWeek = new Map(weeks.map((standing) => [standing.sportEventId, standing.countingPickLimit]));
    const seasonGameCount = [...gameCountByWeek.values()].reduce((sum, count) => sum + count, 0);
    const standingsUpserted = await this.settleContestTotals(contest, seasonGameCount, 'HIGHER_IS_BETTER', completedAt);
    const completed = await this.deps.contests.transitionStatus(contest.id, {
      from: SETTLEABLE,
      to: ContestStatus.COMPLETED,
      endsAt: completedAt,
    });
    this.logger.info({ contestId: contest.id, sportEventId, standingsUpserted, completed }, 'Settled a pick\'em contest\'s season after its last week');
    return { standingsUpserted, completed };
  }

  /**
   * Settles one week of a survivor contest (#719): each entry still in coming into the week is
   * frozen with 1 when it survived the week and 0 when it went out, survivors first. Entries out
   * before the week have no standing for it, and a cancelled week counts for nothing (#743). A
   * week settles once. When the contest's last week settles, the weeks survived are summed and
   * ranked into contest standings, entries out in the same week sharing a place, and the contest
   * is COMPLETED.
   */
  private async settleSurvivorWeek(
    contest: Contest,
    sportEvent: SportEvent,
    completedAt: Date,
  ): Promise<{ standingsUpserted: number; completed: boolean }> {
    const sportEventId = sportEvent.id;
    const settledWeeks = await this.deps.eventStandings.findByContest(contest.id);
    if (sportEvent.status !== SportEventStatus.CANCELLED && !settledWeeks.some((standing) => standing.sportEventId === sportEventId)) {
      const season = await loadSurvivorSeason(this.deps, contest, completedAt);
      const weekIndex = season.weeks.findIndex((week) => week.event.id === sportEventId);
      const decided = season.entries.flatMap(({ entry, run }) => {
        const outcome = run.weeks[weekIndex]?.outcome ?? null;
        return outcome === SurvivorWeekOutcome.SURVIVED || outcome === SurvivorWeekOutcome.ELIMINATED
          ? [{ entry, survived: outcome === SurvivorWeekOutcome.SURVIVED }]
          : [];
      });
      const survivorCount = decided.filter(({ survived }) => survived).length;
      const placeOf = (survived: boolean) => {
        const position = survived ? 1 : survivorCount + 1;
        const sharing = survived ? survivorCount : decided.length - survivorCount;
        return { position, displayPosition: sharing > 1 ? `T${position}` : String(position) };
      };
      for (const { entry, survived } of decided) {
        await this.deps.eventStandings.upsert({
          contestId: contest.id,
          contestEntryId: entry.id,
          sportEventId,
          ...placeOf(survived),
          // One pick a week, decided once its game is played.
          countingPickLimit: 1,
          scoredPickCount: 1,
          asOf: completedAt,
          settledAt: completedAt,
          totalScore: survived ? 1 : 0,
        });
      }
      this.logger.info({ contestId: contest.id, sportEventId, entryCount: decided.length, survivorCount }, 'Settled one week of a survivor contest');
    }
    if (!(await this.allEventsFinished(contest))) {
      return { standingsUpserted: 0, completed: false };
    }
    const weeks = new Set((await this.deps.eventStandings.findByContest(contest.id)).map((standing) => standing.sportEventId));
    const standingsUpserted = await this.settleContestTotals(contest, weeks.size, 'HIGHER_IS_BETTER', completedAt);
    const completed = await this.deps.contests.transitionStatus(contest.id, {
      from: SETTLEABLE,
      to: ContestStatus.COMPLETED,
      endsAt: completedAt,
    });
    this.logger.info({ contestId: contest.id, sportEventId, standingsUpserted, completed }, 'Settled a survivor contest\'s season after its last week');
    return { standingsUpserted, completed };
  }

  /** Whether every event the contest covers has completed or been cancelled: then the contest itself settles. */
  private async allEventsFinished(contest: Contest): Promise<boolean> {
    const events = await this.deps.sportEvents.findByIds(contest.sportEventIds);
    return events.length === contest.sportEventIds.length
      && events.every((event) => FINISHED_EVENT_STATUSES.includes(event.status));
  }

  /**
   * The contest's settled total (#713): each entry's frozen event scores summed and ranked, the
   * single writer of ContestEntryStanding (and so of its denormalized contestId). In a one-event
   * contest the total is that event's standing. Answers how many standings it wrote.
   */
  private async settleContestTotals(
    contest: Contest,
    countingPickLimit: number,
    direction: Parameters<typeof rankContestTotals>[2],
    completedAt: Date,
  ): Promise<number> {
    const [entries, eventStandings] = await Promise.all([
      this.deps.entries.findByContestWithSquad(contest.id),
      this.deps.eventStandings.findByContest(contest.id),
    ]);
    const settledEntryIds = new Set(eventStandings.map((standing) => standing.contestEntryId));
    const totals = rankContestTotals(
      entries.filter((entry) => settledEntryIds.has(entry.id)),
      eventStandings.map((standing) => ({
        entryId: standing.contestEntryId,
        sportEventId: standing.sportEventId,
        score: standing.totalScore,
        scoredPickCount: standing.scoredPickCount,
      })),
      direction,
    );
    const asOf = eventStandings
      .map((standing) => standing.asOf)
      .filter((value): value is Date => value !== null)
      .sort((left, right) => right.getTime() - left.getTime())
      .at(0) ?? completedAt;
    for (const total of totals) {
      await this.deps.standings.upsert({
        contestId: contest.id,
        contestEntryId: total.entryId,
        position: total.position,
        displayPosition: total.displayPosition,
        countingPickLimit,
        scoredPickCount: total.scoredPickCount,
        asOf,
        settledAt: completedAt,
        totalScore: total.score,
      });
    }
    return totals.length;
  }
}

function resolveContestStandingAsOf(
  participants: ParticipantScore[],
  fallback: Date,
): Date {
  const latest = participants
    .map((participant) => participant.asOf)
    .filter((asOf): asOf is Date => asOf !== null)
    .sort((left, right) => right.getTime() - left.getTime())
    .at(0);
  return latest ?? fallback;
}

