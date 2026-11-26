/**
 * MatchResultService — the admin's results for a bracket event (#699, plans/knockout-and-pickem-design.md
 * §3.3), the head-to-head counterpart of racing's finishing order. The admin marks a match's winner,
 * with both scores or neither (a series' score is games won), or a game of a week as a tie (#792)
 * with its level scores; saving it, all or none:
 *
 * - completes the match with its winner and scores,
 * - puts the winner on the side of the match it advances to,
 * - and rewrites every team's core standing from the bracket: champion 1, runner-up 2, teams out in
 *   the same round sharing a place below everyone who went further, a team that lost ELIMINATED,
 *   and `currentRound` the latest round the team has a match in. A week of games that forms no
 *   bracket (#768) ranks no team: a team is COMPLETE once its game is played or cancelled.
 *
 * A result can be changed, or cleared, until the match its winner advanced to has a result of its
 * own (409 SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED): changing an early winner then would leave the later
 * match between the wrong teams, so the admin clears the later result first. Fixing only the
 * scores never moves a team and is always allowed.
 *
 * A level score is a tie only where the slot's games can end level (`canEndTied`, #2046), and never
 * in a bracket. Where they cannot, a shoot-out settles it (#791): its winner is named by the
 * shoot-out's scores, kept apart from the game's score (IFAB Law 10) as Game 1's SHOOTOUT period.
 *
 * A result writes each side's outcome (#2046), the rollup of the match's Games: WON and LOST, or
 * TIED on both sides. A single game's scores are its Game 1's; a series' scores are games won,
 * counted from its Games, so its result writes no Game.
 *
 * A match in any sport may end early (#704): a retirement or a default stops it where it stood, so
 * its winner's score may be the lower, and a walkover was never played, so it has no score. Its
 * winner wins in full: every scorer reads only `winnerSide`.
 *
 * In a reseeded bracket (#722) a match before a reseed links nowhere: its winner's next match is
 * the one the admin placed it in. Changing or clearing that result swaps or empties the winner's
 * place there, under the same lock, and the admin can set the round again before it starts.
 */
import type { FastifyBaseLogger } from 'fastify';
import type {
  BracketStandingWrite,
  GameSideScoreWrite,
  MatchResultWrite,
  MatchSideFill,
  SportEventRoundMatchRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import {
  MatchEnding,
  describeMatchPlace,
  isAtPlace,
  type MatchPlace,
  matchPlaceOf,
  MatchSideOutcome,
  MatchStatus,
  ParticipantStandingStatus,
  PeriodKind,
  finalRoundsOfMatches,
  SportEventStatus,
  compareScores,
  gameNumbered,
  gameScoreOf,
  getSportDefinition,
  matchPeriodsOf,
  rankSortedScores,
  eventPlaysMatches,
  runningPeriodScores,
  sideOfParticipant,
  winnerParticipantId,
  type BackgroundJobRequest,
  type GamePeriodScore,
  type SportEvent,
  type SportEventRoundMatch,
  type SportEventRoundMatchGame,
  type SportMatchPeriods,
  hasPeriodScores,
} from '@poolmaster/shared/domain';
import { SportEventError } from '../../events/errors';
import type { EventLifecycleService } from '../../events/event-lifecycle-service';
import type { JobsForWrite } from '../../background-jobs/background-job-queue';
import { DomainEventType, type DomainEvents } from '../../domain-events';
import { formsNoBracket } from '../../events/sport-event-bracket-service';

/** One side's part of a result: its score (games won, for a series) and its shoot-out kicks scored. */
interface SideResultInput {
  sideNumber: number;
  score: number | null;
  /** Left out is none. */
  shootoutScore?: number | null;
}

export interface MatchResultInput {
  /** The side number that won; null for a tie (#792), only where the games can end level. */
  winnerSideNumber: number | null;
  /**
   * Both sides: both scores or neither, the winner's the higher unless a shoot-out settled a
   * level score; both shoot-out scores or neither. A tie needs both scores, level.
   */
  sides: readonly SideResultInput[];
  /** How the match ended (#704); left out is PLAYED. */
  ending?: MatchEnding;
}

/** Each side's running score at the end of one period, as the scoreboard shows it, by side number. */
export type PeriodScoreInput = readonly { sideNumber: number; score: number }[];

export interface MatchResultServiceDeps {
  sportEvents: Pick<SportEventRepository, 'findById'>;
  matches: Pick<SportEventRoundMatchRepository, 'findBySportEvent' | 'applyResult' | 'saveGamePeriodScores'>;
  /**
   * Starts the event's contests whose cutoff a result shows has passed (#721): a period score puts
   * a squares contest on that game live even where the scheduler leaves the event to an admin (#711). A game's result
   * or cancellation is a GAME_DECIDED, which settles the squares contests played on it.
   */
  contestActivation: Pick<EventLifecycleService, 'activateContestsPastCutoff'>;
  /** What follows each result and score it writes (#1946): the app's one map. */
  domainEvents: Pick<DomainEvents, 'collect'>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

/** Each side's outcome once the match is decided: the winner WON and the other LOST, or both TIED. */
function outcomesOf(match: SportEventRoundMatch, winnerSideNumber: number | null): MatchResultWrite['outcomes'] {
  return match.sides.map(({ sideNumber }) => ({
    sideNumber,
    outcome: winnerSideNumber === null ? MatchSideOutcome.TIED : sideNumber === winnerSideNumber ? MatchSideOutcome.WON : MatchSideOutcome.LOST,
  }));
}

/** Every side PENDING: a match without a result. */
function pendingOutcomes(match: SportEventRoundMatch): MatchResultWrite['outcomes'] {
  return match.sides.map(({ sideNumber }) => ({ sideNumber, outcome: MatchSideOutcome.PENDING }));
}

/** Game 1's period scores of play, each side's running totals by period number. */
function runningRegularPeriods(game: SportEventRoundMatchGame | null): { periodNumber: number; totals: ReadonlyMap<number, number> }[] {
  return game === null ? [] : runningPeriodScores(game).filter((period) => period.kind === PeriodKind.REGULAR);
}

/** The match as a result leaves it: its status, its sides' outcomes and its Game 1's scores. */
function withResult(match: SportEventRoundMatch, { id: _id, outcomes, gameOne, ...values }: MatchResultWrite): SportEventRoundMatch {
  return {
    ...match,
    ...values,
    sides: match.sides.map((side) => ({ ...side, outcome: outcomes.find((each) => each.sideNumber === side.sideNumber)?.outcome ?? side.outcome })),
    games: gameOne === null ? match.games : match.games.map((game) => (game.id !== gameOne.gameId ? game : withSideScores(game, gameOne.scores, values.status, values.completedAt))),
  };
}

/** A Game with its sides' scores and shoot-out as written. */
function withSideScores(game: SportEventRoundMatchGame, scores: readonly GameSideScoreWrite[], status: SportEventRoundMatchGame['status'], completedAt: Date | null): SportEventRoundMatchGame {
  return {
    ...game,
    status,
    completedAt,
    sideResults: game.sideResults.map((result) => {
      const write = scores.find((each) => each.sideNumber === result.sideNumber);
      if (write === undefined) return result;
      const shootout: GamePeriodScore[] = write.shootoutScore === null ? [] : [{ kind: PeriodKind.SHOOTOUT, periodNumber: 1, score: write.shootoutScore }];
      return { ...result, score: write.score, periodScores: [...result.periodScores.filter((period) => period.kind !== PeriodKind.SHOOTOUT), ...shootout] };
    }),
  };
}

/** Whether a loaded game sends its winner on to a later match. */
const linksOn = (match: SportEventRoundMatch): boolean => match.advancesToMatchId !== null;

/**
 * Every team's standing in a week of games that forms no bracket: no place, since a week has no
 * winner of its own, and COMPLETE once the team's game is played or cancelled, ACTIVE until then.
 */
export function gameStandings(matches: readonly SportEventRoundMatch[], asOf: Date): BracketStandingWrite[] {
  return matches.flatMap((match) => match.sides
    .flatMap((side) => (side.sportEventParticipantId === null ? [] : [side.sportEventParticipantId]))
    .map((sportEventParticipantId) => ({
      sportEventParticipantId,
      position: null,
      displayPosition: null,
      status: match.status === MatchStatus.COMPLETED || match.status === MatchStatus.CANCELLED
        ? ParticipantStandingStatus.COMPLETE
        : ParticipantStandingStatus.ACTIVE,
      currentRound: match.roundNumber,
      asOf,
    })));
}

/**
 * Every bracket team's standing from the bracket's results. A team is ranked by how far it went:
 * the champion first, then each team by the round it went out in (later is better), and a team
 * still alive just ahead of those out in the round it has reached. Teams out in the same round,
 * and teams alive in the same round, share a place.
 */
export function bracketStandings(matches: readonly SportEventRoundMatch[], asOf: Date): BracketStandingWrite[] {
  const highestRound = Math.max(0, ...matches.map((match) => match.roundNumber));
  const finalRounds = finalRoundsOfMatches(matches);
  const progress = new Map<string, { roundReached: number; lostInRound: number | null; champion: boolean }>();
  for (const match of matches) {
    for (const side of match.sides) {
      const rowId = side.sportEventParticipantId;
      if (rowId === null) continue;
      const team = progress.get(rowId) ?? { roundReached: match.roundNumber, lostInRound: null, champion: false };
      team.roundReached = Math.max(team.roundReached, match.roundNumber);
      if (match.status === MatchStatus.COMPLETED && (side.outcome === MatchSideOutcome.WON || side.outcome === MatchSideOutcome.LOST)) {
        if (side.outcome === MatchSideOutcome.WON) {
          // The final is the match of the final's round (#2006), which sends its winner nowhere. A
          // winner a reseed has still to place has reached the next round.
          if (match.advancesToMatchId === null && finalRounds.has(match.roundNumber)) team.champion = true;
          else if (match.advancesToMatchId === null) team.roundReached = Math.max(team.roundReached, match.roundNumber + 1);
        } else {
          team.lostInRound = match.roundNumber;
        }
      }
      progress.set(rowId, team);
    }
  }
  // How far each team went, higher is further: out in round N is 2N, alive in round N is 2N + 1,
  // and the champion is past every round.
  const reach = [...progress].map(([sportEventParticipantId, team]) => ({
    sportEventParticipantId,
    team,
    reach: team.champion ? 2 * highestRound + 2 : team.lostInRound !== null ? 2 * team.lostInRound : 2 * team.roundReached + 1,
  })).sort((left, right) => compareScores('HIGHER_IS_BETTER', left.reach, right.reach));
  const ranks = rankSortedScores(reach.map((row) => row.reach));
  return reach.map(({ sportEventParticipantId, team }, index) => ({
    sportEventParticipantId,
    position: ranks[index].position,
    displayPosition: ranks[index].displayPosition,
    status: team.lostInRound !== null
      ? ParticipantStandingStatus.ELIMINATED
      : team.champion ? ParticipantStandingStatus.COMPLETE : ParticipantStandingStatus.ACTIVE,
    currentRound: team.roundReached,
    asOf,
  }));
}

export class MatchResultService {
  constructor(private readonly deps: MatchResultServiceDeps) {}

  /**
   * Enters or changes one match's result: a winner, or a tie (#792) in a game of a week, which
   * forms no bracket (a knockout always has a winner). 404 BRACKET_MATCH_NOT_FOUND; 422
   * MATCH_SIDES_NOT_SET while a side still waits for its team; 422 MATCH_RESULT_INVALID for one
   * score without the other, scores the winner did not win by, a tie that does not fit, a
   * shoot-out that does not fit, or an early ending that does not (`describeScoreProblem`); 409 SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED for
   * a new winner once the next match has a result. The feed is its only writer on a synced event (#2074).
   */
  async recordResult(sportEventId: string, place: MatchPlace, input: MatchResultInput): Promise<SportEventRoundMatch[]> {
    const sportEvent = await this.requireReleasedBracketEvent(sportEventId);
    const bracket = await this.deps.matches.findBySportEvent(sportEventId);
    const match = this.requireMatch(sportEventId, bracket, place);
    if (match.sides.some((side) => side.sportEventParticipantId === null)) {
      this.deps.logger?.warn({ sportEventId, ...place }, 'Refused a result for a match whose teams are not both known');
      throw new SportEventError(
        `${describeMatchPlace(place, { sentenceStart: true })} does not have both teams yet: enter the results of the matches that feed it first.`,
        'MATCH_SIDES_NOT_SET',
        422,
      );
    }
    const ending = input.ending ?? MatchEnding.PLAYED;
    const scoreProblem = describeScoreProblem(input, {
      inBracket: !formsNoBracket(bracket, linksOn),
      canEndTied: match.slot.canEndTied,
    }) ?? describeWalkoverPeriods(match, ending) ?? describeFinalBelowPeriods(match, input, matchPeriodsOf(sportEvent.sport, sportEvent.matchPeriodLayout ?? null));
    if (scoreProblem) {
      this.deps.logger?.warn({ sportEventId, ...place, scoreProblem }, 'Refused a match result with invalid scores');
      throw new SportEventError(`${describeMatchPlace(place, { sentenceStart: true })}'s result cannot be saved: ${scoreProblem}.`, 'MATCH_RESULT_INVALID', 422);
    }
    const winnerChanges = match.status !== MatchStatus.COMPLETED || winnerSideNumberOf(match) !== input.winnerSideNumber;
    if (winnerChanges) {
      this.assertNextMatchOpen(sportEventId, bracket, match);
    }

    const now = this.deps.now?.() ?? new Date();
    const gameOne = gameNumbered(match, 1);
    const result: MatchResultWrite = {
      id: match.id,
      status: MatchStatus.COMPLETED,
      ending,
      completedAt: now,
      outcomes: outcomesOf(match, input.winnerSideNumber),
      // A single game's score is its Game 1's; a series' is counted from its Games.
      gameOne: match.slot.seriesGames !== 1 || gameOne === null ? null : {
        gameId: gameOne.id,
        scores: input.sides.map(({ sideNumber, score, shootoutScore }) => ({ sideNumber, score, shootoutScore: shootoutScore ?? null })),
      },
    };
    // A tie sends nobody on: only a game that forms no bracket can end level.
    const winnerTeam = match.sides.find((side) => side.sideNumber === input.winnerSideNumber)?.sportEventParticipantId ?? null;
    const sideFill = input.winnerSideNumber === null ? null : this.advance(bracket, match, winnerTeam);
    // The game is decided: what follows (its squares contests' settling, the boards' rebuild) is
    // written with its result.
    const jobs = await this.decided(sportEventId, match.id, now);
    const after = await this.write(sportEventId, bracket, result, sideFill, jobs.jobs);
    jobs.queued();
    this.deps.logger?.info({ sportEventId, ...place, winnerSideNumber: input.winnerSideNumber, ending, winnerChanges }, 'Saved a match result');
    // The bracket as written stands in for a read of it (#1355).
    if (sportEvent.status === SportEventStatus.IN_PROGRESS) {
      await this.deps.contestActivation.activateContestsPastCutoff(sportEvent, now, after);
    }
    return after;
  }

  /**
   * Cancels one game of a released event that was never played (#715, design Q5.9): a postponed
   * regular-season game is cancelled in its week and added to the week it moves to while that week
   * is still a draft. A cancelled game counts for no pick and no standing. Cancelling a cancelled
   * game changes nothing. 404 BRACKET_MATCH_NOT_FOUND; 409 MATCH_ALREADY_PLAYED for a game with a
   * result; 422 MATCH_IN_BRACKET for a game of a bracket (it sends its winner on, takes a team from
   * an earlier game, or sits among games of several rounds), since a bracket cannot lose a game.
   */
  async cancelMatch(sportEventId: string, place: MatchPlace): Promise<SportEventRoundMatch[]> {
    await this.requireReleasedBracketEvent(sportEventId);
    const bracket = await this.deps.matches.findBySportEvent(sportEventId);
    const match = this.requireMatch(sportEventId, bracket, place);
    if (match.status === MatchStatus.CANCELLED) {
      return bracket;
    }
    if (match.status === MatchStatus.COMPLETED) {
      this.deps.logger?.warn({ sportEventId, ...place }, 'Refused to cancel a game that has a result');
      throw new SportEventError(
        `${describeMatchPlace(place, { sentenceStart: true })} has a result: clear it before cancelling the game.`,
        'MATCH_ALREADY_PLAYED',
        409,
      );
    }
    // A reseeded bracket links no games, but its games still span several rounds.
    if (!formsNoBracket(bracket, linksOn)) {
      this.deps.logger?.warn({ sportEventId, ...place }, 'Refused to cancel a bracket game');
      throw new SportEventError(
        `${describeMatchPlace(place, { sentenceStart: true })} is part of a bracket, which cannot lose a game: change its time instead.`,
        'MATCH_IN_BRACKET',
        422,
      );
    }
    // Only an admin cancels a match.
    const result: MatchResultWrite = { id: match.id, status: MatchStatus.CANCELLED, ending: MatchEnding.PLAYED, completedAt: null, outcomes: pendingOutcomes(match), gameOne: null };
    // A squares contest on the game ends Final with no scores (#711, #743), in a job written with it.
    const jobs = await this.decided(sportEventId, match.id, this.deps.now?.() ?? new Date());
    const after = await this.write(sportEventId, bracket, result, null, jobs.jobs);
    jobs.queued();
    this.deps.logger?.info({ sportEventId, ...place }, 'Cancelled a game');
    return after;
  }

  /**
   * Enters or corrects the score at the end of one period of a game (#772): the end of the first,
   * second or third quarter in American football, as the scoreboard shows it. It can go in while
   * the game is played and be corrected after it. The last period's score is the final result,
   * entered with `recordResult`. 422 MATCH_PERIOD_INVALID for a sport without periods or a period
   * that is not one before the last; 404 BRACKET_MATCH_NOT_FOUND; 422 MATCH_SIDES_NOT_SET while a
   * side waits for its team; 409 MATCH_CANCELLED for a cancelled game; 422 MATCH_PERIOD_SCORE_INVALID
   * for a score below an earlier period's or above a later one's or the final score.
   */
  async recordPeriodScore(sportEventId: string, place: MatchPlace, periodNumber: number, input: PeriodScoreInput): Promise<SportEventRoundMatch[]> {
    const { sportEvent, match, periods } = await this.requirePeriod(sportEventId, place, periodNumber);
    if (match.sides.some((side) => side.sportEventParticipantId === null)) {
      this.deps.logger?.warn({ sportEventId, ...place, periodNumber }, 'Refused a period score for a game whose teams are not both known');
      throw new SportEventError(
        `${describeMatchPlace(place, { sentenceStart: true })} does not have both teams yet, so it has no score.`,
        'MATCH_SIDES_NOT_SET',
        422,
      );
    }
    const problem = describePeriodScoreProblem(match, periodNumber, input, periods);
    if (problem) {
      this.deps.logger?.warn({ sportEventId, ...place, periodNumber, problem }, 'Refused a period score out of step with the game\'s other scores');
      throw new SportEventError(
        `The score at the end of ${periods.label.one} ${periodNumber} of the ${describeMatchPlace(place)} cannot be saved: ${problem}.`,
        'MATCH_PERIOD_SCORE_INVALID',
        422,
      );
    }
    const now = this.deps.now?.() ?? new Date();
    // A quarter entered after the result may be the last one a squares contest waits for: its
    // settling job is written with the score.
    const jobs = match.status === MatchStatus.COMPLETED ? await this.decided(sportEventId, match.id, now) : await this.rebuild(sportEventId);
    await this.deps.matches.saveGamePeriodScores(periodPointsWrite(match, periodNumber, input), jobs.jobs);
    jobs.queued();
    this.deps.logger?.info({ sportEventId, ...place, periodNumber }, 'Saved a period score');
    // A scored period means the game is under way: a squares contest on it goes live (#711).
    if (sportEvent.status === SportEventStatus.IN_PROGRESS) {
      await this.deps.contestActivation.activateContestsPastCutoff(sportEvent, now);
    }
    return this.deps.matches.findBySportEvent(sportEventId);
  }

  /** A released event's game, of a sport with periods, and a period of it before the last. */
  private async requirePeriod(
    sportEventId: string,
    place: MatchPlace,
    periodNumber: number,
  ): Promise<{ sportEvent: SportEvent; match: SportEventRoundMatch; periods: SportMatchPeriods }> {
    const sportEvent = await this.requireReleasedBracketEvent(sportEventId);
    const periods = matchPeriodsOf(sportEvent.sport, sportEvent.matchPeriodLayout ?? null);
    if (!periods) {
      this.deps.logger?.warn({ sportEventId, sport: sportEvent.sport }, 'Refused a period score for a sport without periods');
      throw new SportEventError(
        `A ${getSportDefinition(sportEvent.sport).name.toLowerCase()} game keeps no score by period.`,
        'MATCH_PERIOD_INVALID',
        422,
      );
    }
    if (periodNumber >= periods.count) {
      this.deps.logger?.warn({ sportEventId, ...place, periodNumber }, 'Refused a score for the last period or past it');
      throw new SportEventError(
        `A game has ${periods.count} ${periods.label.many}, and the score at the end of the last is the final score: enter it as the game's result.`,
        'MATCH_PERIOD_INVALID',
        422,
      );
    }
    const match = this.requireMatch(sportEventId, await this.deps.matches.findBySportEvent(sportEventId), place);
    if (match.status === MatchStatus.CANCELLED) {
      this.deps.logger?.warn({ sportEventId, ...place }, 'Refused a period score for a cancelled game');
      throw new SportEventError(`${describeMatchPlace(place, { sentenceStart: true })} was cancelled, so it has no score.`, 'MATCH_CANCELLED', 409);
    }
    return { sportEvent, match, periods };
  }

  /**
   * The side of the next match the result puts `rowId` on, or empties; null for the final, and for
   * a match before a reseed whose winner is not placed yet.
   */
  private advance(bracket: readonly SportEventRoundMatch[], match: SportEventRoundMatch, rowId: string | null): MatchSideFill | null {
    if (match.advancesToMatchId !== null && match.advancesToSideNumber !== null) {
      return { id: match.advancesToMatchId, sideNumber: match.advancesToSideNumber, sportEventParticipantId: rowId };
    }
    const placed = placementOf(bracket, match);
    return placed ? { id: placed.match.id, sideNumber: placed.sideNumber, sportEventParticipantId: rowId } : null;
  }

  private async write(
    sportEventId: string,
    bracket: readonly SportEventRoundMatch[],
    result: MatchResultWrite,
    sideFill: MatchSideFill | null,
    jobs: readonly BackgroundJobRequest[],
  ): Promise<SportEventRoundMatch[]> {
    // The standings are read off the bracket as it will stand after this write, which is answered.
    const after = bracket.map((candidate) => {
      if (candidate.id === result.id) return withResult(candidate, result);
      if (sideFill && candidate.id === sideFill.id) {
        return {
          ...candidate,
          sides: candidate.sides.map((side) => (side.sideNumber === sideFill.sideNumber ? { ...side, sportEventParticipantId: sideFill.sportEventParticipantId } : side)),
        };
      }
      return candidate;
    });
    const asOf = (this.deps.now ?? (() => new Date()))();
    const standings = formsNoBracket(after, linksOn) ? gameStandings(after, asOf) : bracketStandings(after, asOf);
    await this.deps.matches.applyResult({ result, sideFill, standings, jobs });
    this.deps.logger?.debug({ sportEventId, matchId: result.id }, 'Rewrote the event standings');
    return after;
  }

  /** What follows a game's being decided (#711, #1946), for the write deciding it to carry. */
  private decided(sportEventId: string, sportEventRoundMatchId: string, decidedAt: Date): Promise<JobsForWrite> {
    return this.deps.domainEvents.collect({ type: DomainEventType.GAME_DECIDED, sportEventId, sportEventRoundMatchId, decidedAt });
  }

  /** What follows a change to a game that decides nothing: the boards' rebuild (#1466). */
  private rebuild(sportEventId: string): Promise<JobsForWrite> {
    return this.deps.domainEvents.collect({ type: DomainEventType.SPORT_EVENT_RESULTS_CHANGED, sportEventId });
  }

  private assertNextMatchOpen(sportEventId: string, bracket: readonly SportEventRoundMatch[], match: SportEventRoundMatch): void {
    const next = bracket.find((candidate) => candidate.id === match.advancesToMatchId) ?? placementOf(bracket, match)?.match;
    // A quarter score belongs to the two teams playing (#772), so a next match with one is locked
    // as one with a result is: changing who plays it would leave the score on another pairing.
    if (next && (next.status === MatchStatus.COMPLETED || hasPeriodScores(next))) {
      this.deps.logger?.warn({ sportEventId, match: matchPlaceOf(match), next: matchPlaceOf(next) }, 'Refused a match result change after the next match was decided or scored');
      throw new SportEventError(
        next.status === MatchStatus.COMPLETED
          ? `${describeMatchPlace(match, { sentenceStart: true })}'s winner already played the ${describeMatchPlace(next)}, which has a result: clear its result first.`
          : `${describeMatchPlace(match, { sentenceStart: true })}'s winner is playing the ${describeMatchPlace(next)}, which has scores entered: clear them first.`,
        'SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED',
        409,
      );
    }
  }

  private requireMatch(sportEventId: string, bracket: readonly SportEventRoundMatch[], place: MatchPlace): SportEventRoundMatch {
    const match = bracket.find((candidate) => isAtPlace(candidate, place));
    if (!match) {
      throw new SportEventError(`Sport event ${sportEventId} has no ${describeMatchPlace(place)}.`, 'BRACKET_MATCH_NOT_FOUND', 404);
    }
    return match;
  }

  /**
   * The event results are entered for: one that plays a bracket (422 SPORT_EVENT_NOT_BRACKET) and is
   * released (409 SPORT_EVENT_NOT_RELEASED), since a draft's pairings can still change.
   */
  private async requireReleasedBracketEvent(sportEventId: string): Promise<SportEvent> {
    const event = await this.deps.sportEvents.findById(sportEventId);
    if (!event) {
      throw new SportEventError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    if (!eventPlaysMatches(event)) {
      this.deps.logger?.warn({ sportEventId, sport: event.sport }, 'Refused a match result for an event that plays no bracket');
      throw new SportEventError(
        `A ${getSportDefinition(event.sport).name.toLowerCase()} event is not played as a bracket.`,
        'SPORT_EVENT_NOT_BRACKET',
        422,
      );
    }
    if (event.status === SportEventStatus.DRAFT) {
      this.deps.logger?.warn({ sportEventId }, 'Refused a match result for an event that is not released');
      throw new SportEventError(
        `Sport event ${sportEventId} is not released yet: its bracket can still change, so it takes no results.`,
        'SPORT_EVENT_NOT_RELEASED',
        409,
      );
    }
    return event;
  }
}

/** The side number that won a decided match, or null for a tie or a match without a result. */
function winnerSideNumberOf(match: SportEventRoundMatch): number | null {
  return match.sides.find((side) => side.outcome === MatchSideOutcome.WON)?.sideNumber ?? null;
}

/**
 * Where a reseed placed the winner of a match that links nowhere: the next round's match naming it, and
 * the side. Undefined for a match without a result, or a winner not placed yet.
 */
function placementOf(bracket: readonly SportEventRoundMatch[], match: SportEventRoundMatch): { match: SportEventRoundMatch; sideNumber: number } | undefined {
  if (match.advancesToMatchId !== null || match.status !== MatchStatus.COMPLETED) return undefined;
  const winnerId = winnerParticipantId(match);
  if (winnerId === null) return undefined;
  for (const later of bracket) {
    if (later.roundNumber !== match.roundNumber + 1) continue;
    const side = sideOfParticipant(later, winnerId);
    if (side !== null) return { match: later, sideNumber: side.sideNumber };
  }
  return undefined;
}

/** Where a result is entered: in a bracket or a week of games, and whether the slot's games can end level. */
export interface ScoreRules {
  inBracket: boolean;
  canEndTied: boolean;
}

/**
 * What is wrong with a result's scores, or null. Both scores or neither, and the winner's the
 * higher; except that a level score where the games cannot end level (`canEndTied` false, #2046)
 * names its winner by both shoot-out scores (#791), the winner's the higher. Shoot-out scores are
 * refused where the games can end level, and on a result that is not level. A tie (#792) needs a
 * game that can end level outside a bracket, and both scores, level. A match ended early (#704)
 * has a winner and no shoot-out: after a retirement or a default both scores or neither, the
 * winner's possibly the lower; after a walkover none.
 */
export function describeScoreProblem(
  { winnerSideNumber, sides, ending = MatchEnding.PLAYED }: Pick<MatchResultInput, 'winnerSideNumber' | 'sides' | 'ending'>,
  rules: ScoreRules,
): string | null {
  const scores = sides.map((side) => side.score);
  const kicks = sides.map((side) => side.shootoutScore ?? null);
  const hasShootout = kicks.some((each) => each !== null);
  const noScores = scores.every((score) => score === null);
  const bothScores = scores.every((score) => score !== null);
  if (ending !== MatchEnding.PLAYED) {
    if (winnerSideNumber === null) return 'a tie is played to its end';
    if (hasShootout) return 'a match that ended early has no shoot-out';
    if (ending === MatchEnding.WALKOVER) return noScores ? null : 'a walkover has no score';
    return noScores || bothScores ? null : 'give both scores or neither';
  }
  if (hasShootout && rules.canEndTied) return 'a game that can end level is never settled by a shoot-out';
  if (winnerSideNumber === null) {
    if (rules.inBracket) return 'a bracket match always has a winner';
    if (!rules.canEndTied) return 'this game cannot end level';
    const [first, second] = scores;
    return bothScores && first === second ? null : 'a tie needs both scores, level';
  }
  if (noScores) return hasShootout ? 'a shoot-out needs the score after extra time, level' : null;
  if (!bothScores) return 'give both scores or neither';
  const winner = sides.find((side) => side.sideNumber === winnerSideNumber);
  const loser = sides.find((side) => side.sideNumber !== winnerSideNumber);
  if (winner?.score == null || loser?.score == null) return 'the winner must be one of the match\'s sides';
  if (winner.score !== loser.score) {
    if (hasShootout) return 'a shoot-out is only held after a level score';
    return winner.score > loser.score ? null : 'the winner\'s score must be higher than the loser\'s';
  }
  if (rules.canEndTied) return 'the winner\'s score must be higher than the loser\'s';
  const winnerKicks = winner.shootoutScore ?? null;
  const loserKicks = loser.shootoutScore ?? null;
  if (winnerKicks === null || loserKicks === null) return 'a level score needs both shoot-out scores';
  return winnerKicks > loserKicks ? null : 'the winner\'s shoot-out score must be higher than the loser\'s';
}

/**
 * What is wrong with the running score at the end of `periodNumber`, or null. A scoreboard's score
 * never goes down, so neither side's may be below its score at the end of an earlier period, or
 * above its score at the end of a later one or its final score (overtime included). A walkover
 * (#704) has no score at all.
 */
export function describePeriodScoreProblem(
  match: SportEventRoundMatch,
  periodNumber: number,
  score: PeriodScoreInput,
  periods: SportMatchPeriods,
): string | null {
  if (match.status === MatchStatus.COMPLETED && match.ending === MatchEnding.WALKOVER) return 'it was a walkover, which has no score';
  const of = (totals: PeriodScoreInput, sideNumber: number) => totals.find((each) => each.sideNumber === sideNumber)?.score ?? 0;
  const below = (left: PeriodScoreInput, right: PeriodScoreInput) => match.sides.some(({ sideNumber }) => of(left, sideNumber) < of(right, sideNumber));
  const gameOne = gameNumbered(match, 1);
  for (const other of runningRegularPeriods(gameOne)) {
    const totals = [...other.totals].map(([sideNumber, total]) => ({ sideNumber, score: total }));
    if (other.periodNumber < periodNumber && below(score, totals)) {
      return `a side's score is lower than at the end of ${periods.label.one} ${other.periodNumber}`;
    }
    if (other.periodNumber > periodNumber && below(totals, score)) {
      return `a side's score is higher than at the end of ${periods.label.one} ${other.periodNumber}`;
    }
  }
  const final = gameOne === null ? [] : match.sides.flatMap(({ sideNumber }) => {
    const total = gameScoreOf(gameOne, sideNumber);
    return total === null ? [] : [{ sideNumber, score: total }];
  });
  if (match.status === MatchStatus.COMPLETED && final.length > 0 && final.length === match.sides.length && below(final, score)) {
    return 'a side\'s score is higher than its final score';
  }
  return null;
}

/**
 * Game 1's periods of play once the running score at the end of `periodNumber` is entered: each
 * period's own points (#2046), the running score less the one at the end of the period before.
 */
function periodPointsWrite(match: SportEventRoundMatch, periodNumber: number, input: PeriodScoreInput) {
  const gameOne = gameNumbered(match, 1);
  if (gameOne === null) throw new Error(`Match ${match.id} has no Game 1`);
  const running = new Map(runningRegularPeriods(gameOne).map((period) => [period.periodNumber, period.totals]));
  running.set(periodNumber, new Map(input.map((each) => [each.sideNumber, each.score])));
  const ordered = [...running].sort(([left], [right]) => left - right);
  return {
    sportEventRoundMatchId: match.id,
    gameId: gameOne.id,
    sides: match.sides.map(({ sideNumber }) => ({
      sideNumber,
      periodScores: ordered.map(([number, totals], index) => ({
        kind: PeriodKind.REGULAR,
        periodNumber: number,
        score: (totals.get(sideNumber) ?? 0) - (index === 0 ? 0 : ordered[index - 1]?.[1].get(sideNumber) ?? 0),
      })),
    })),
  };
}

/** A walkover was never played, so a match with a score at the end of a period was not one (#704). */
function describeWalkoverPeriods(match: SportEventRoundMatch, ending: MatchEnding): string | null {
  return ending === MatchEnding.WALKOVER && hasPeriodScores(match) ? 'a walkover has no score, so clear its period scores first' : null;
}

/** A final score below a side's score at the end of an entered period, or null when it fits them all. */
function describeFinalBelowPeriods(
  match: SportEventRoundMatch,
  { sides }: MatchResultInput,
  periods: SportMatchPeriods | undefined,
): string | null {
  const finals = sides.flatMap(({ sideNumber, score }) => (score === null ? [] : [{ sideNumber, score }]));
  if (finals.length < sides.length || !periods || match.slot.seriesGames !== 1) return null;
  const higher = runningRegularPeriods(gameNumbered(match, 1))
    .find((period) => finals.some((side) => (period.totals.get(side.sideNumber) ?? 0) > side.score));
  return higher ? `a side's final score is lower than at the end of ${periods.label.one} ${higher.periodNumber}` : null;
}
