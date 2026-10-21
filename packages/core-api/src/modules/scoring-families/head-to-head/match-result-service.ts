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
 * own (409 SPORT_EVENT_MATCH_RESULT_LOCKED): changing an early winner then would leave the later
 * match between the wrong teams, so the admin clears the later result first. Fixing only the
 * scores never moves a team and is always allowed.
 *
 * A bracket match level after extra time, in a sport settled by shoot-out (#791), names its winner
 * by the shoot-out's scores, kept apart from the match score (IFAB Law 10).
 *
 * In a reseeded bracket (#722) a match before a reseed links nowhere: its winner's next match is
 * the one the admin placed it in. Changing or clearing that result swaps or empties the winner's
 * place there, under the same lock, and the admin can set the round again before it starts.
 */
import type { FastifyBaseLogger } from 'fastify';
import type {
  BracketStandingWrite,
  MatchSideFill,
  SportEventMatchRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import {
  MatchSide,
  MatchStatus,
  type SportShootout,
  ParticipantStandingStatus,
  SportEventStatus,
  compareScores,
  getSportDefinition,
  matchPeriodsOf,
  rankSortedScores,
  sportPlaysMatches,
  type SportEvent,
  type SportEventMatch,
  type SportMatchPeriods,
} from '@poolmaster/shared/domain';
import { SportEventError } from '../../events/errors';
import type { EventLifecycleService } from '../../events/event-lifecycle-service';
import { formsNoBracket } from '../../events/sport-event-bracket-service';

export interface MatchResultInput {
  /** The side that won; null for a tie (#792), only in a game of a week, which forms no bracket. */
  winnerSide: MatchSide | null;
  /**
   * Both scores or neither: the winner's must be the higher, unless a shoot-out settled a level
   * score. A tie needs both, level.
   */
  homeScore: number | null;
  awayScore: number | null;
  /** Both or neither (left out is neither): a level bracket match's shoot-out, the winner's the higher. */
  homeShootoutScore?: number | null;
  awayShootoutScore?: number | null;
}

/** A result with no shoot-out, as a cleared or cancelled match is written. */
const NO_SHOOTOUT = { homeShootoutScore: null, awayShootoutScore: null } as const;

/** Both sides' score at the end of one period, as the scoreboard shows it. */
export interface PeriodScoreInput {
  homeScore: number;
  awayScore: number;
}

export interface MatchResultServiceDeps {
  sportEvents: Pick<SportEventRepository, 'findById'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent' | 'applyResult' | 'savePeriodScore' | 'deletePeriodScore'>;
  /**
   * Starts the event's contests whose cutoff a result shows has passed (#721): a result in a
   * second-chance bracket's starting round puts it live even where the scheduler leaves the event
   * to an admin, as a period score does for a squares contest on that game (#711). A game's result
   * or cancellation settles the squares contests played on it.
   */
  contestActivation?: Pick<EventLifecycleService, 'activateContestsPastCutoff' | 'settleContestsForFinishedGame'>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

function sideRowId(match: Pick<SportEventMatch, 'homeSportEventParticipantId' | 'awaySportEventParticipantId'>, side: MatchSide): string | null {
  return side === MatchSide.HOME ? match.homeSportEventParticipantId : match.awaySportEventParticipantId;
}

/** Whether a loaded game sends its winner on to a later match. */
const linksOn = (match: SportEventMatch): boolean => match.advancesToMatchId !== null;

/**
 * Every team's standing in a week of games that forms no bracket: no place, since a week has no
 * winner of its own, and COMPLETE once the team's game is played or cancelled, ACTIVE until then.
 */
export function gameStandings(matches: readonly SportEventMatch[], asOf: Date): BracketStandingWrite[] {
  return matches.flatMap((match) => [match.homeSportEventParticipantId, match.awaySportEventParticipantId]
    .filter((rowId): rowId is string => rowId !== null)
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
export function bracketStandings(matches: readonly SportEventMatch[], asOf: Date): BracketStandingWrite[] {
  const finalRound = Math.max(0, ...matches.map((match) => match.roundNumber));
  const progress = new Map<string, { roundReached: number; lostInRound: number | null; champion: boolean }>();
  for (const match of matches) {
    for (const side of [MatchSide.HOME, MatchSide.AWAY]) {
      const rowId = sideRowId(match, side);
      if (rowId === null) continue;
      const team = progress.get(rowId) ?? { roundReached: match.roundNumber, lostInRound: null, champion: false };
      team.roundReached = Math.max(team.roundReached, match.roundNumber);
      if (match.status === MatchStatus.COMPLETED && match.winnerSide !== null) {
        if (match.winnerSide === side) {
          // The final is the match in the last round, which sends its winner nowhere. A winner a
          // reseed has still to place has reached the next round.
          if (match.advancesToMatchId === null && match.roundNumber === finalRound) team.champion = true;
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
    reach: team.champion ? 2 * finalRound + 2 : team.lostInRound !== null ? 2 * team.lostInRound : 2 * team.roundReached + 1,
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
   * score without the other, scores the winner did not win by, a tie that does not fit, or a
   * shoot-out that does not fit (`describeScoreProblem`); 409 SPORT_EVENT_MATCH_RESULT_LOCKED for
   * a new winner once the next match has a result.
   */
  async recordResult(sportEventId: string, matchNumber: number, input: MatchResultInput): Promise<SportEventMatch[]> {
    const sportEvent = await this.requireReleasedBracketEvent(sportEventId);
    const bracket = await this.deps.matches.findBySportEvent(sportEventId);
    const match = this.requireMatch(sportEventId, bracket, matchNumber);
    if (match.homeSportEventParticipantId === null || match.awaySportEventParticipantId === null) {
      this.deps.logger?.warn({ sportEventId, matchNumber }, 'Refused a result for a match whose teams are not both known');
      throw new SportEventError(
        `Match ${matchNumber} does not have both teams yet: enter the results of the matches that feed it first.`,
        'MATCH_SIDES_NOT_SET',
        422,
      );
    }
    const shootout = {
      homeShootoutScore: input.homeShootoutScore ?? null,
      awayShootoutScore: input.awayShootoutScore ?? null,
    };
    const scoreProblem = describeScoreProblem(input, shootout, {
      inBracket: !formsNoBracket(bracket, linksOn),
      shootout: getSportDefinition(sportEvent.sport).shootout,
    }) ?? describeFinalBelowPeriods(match, input, matchPeriodsOf(sportEvent.sport, sportEvent.matchPeriodLayout ?? null));
    if (scoreProblem) {
      this.deps.logger?.warn({ sportEventId, matchNumber, scoreProblem }, 'Refused a match result with invalid scores');
      throw new SportEventError(`Match ${matchNumber}'s result cannot be saved: ${scoreProblem}.`, 'MATCH_RESULT_INVALID', 422);
    }
    const winnerChanges = match.status !== MatchStatus.COMPLETED || match.winnerSide !== input.winnerSide;
    if (winnerChanges) {
      this.assertNextMatchOpen(sportEventId, bracket, match);
    }

    const result = { id: match.id, status: MatchStatus.COMPLETED, winnerSide: input.winnerSide, homeScore: input.homeScore, awayScore: input.awayScore, ...shootout };
    // A tie sends nobody on: only a game that forms no bracket can end level.
    const sideFill = input.winnerSide === null ? null : this.advance(bracket, match, sideRowId(match, input.winnerSide));
    await this.write(sportEventId, bracket, result, sideFill);
    this.deps.logger?.info({ sportEventId, matchNumber, winnerSide: input.winnerSide, winnerChanges }, 'Saved a match result');
    const now = this.deps.now?.() ?? new Date();
    if (sportEvent.status === SportEventStatus.IN_PROGRESS) {
      await this.deps.contestActivation?.activateContestsPastCutoff(sportEvent, now);
    }
    await this.deps.contestActivation?.settleContestsForFinishedGame(sportEvent, match.id, now);
    return this.deps.matches.findBySportEvent(sportEventId);
  }

  /**
   * Clears one match's result: the match is scheduled again and the side its winner filled is empty.
   * 404 BRACKET_MATCH_NOT_FOUND; 409 SPORT_EVENT_MATCH_RESULT_LOCKED once the next match has a result.
   * Clearing a match with no result changes nothing.
   */
  async clearResult(sportEventId: string, matchNumber: number): Promise<SportEventMatch[]> {
    await this.requireReleasedBracketEvent(sportEventId);
    const bracket = await this.deps.matches.findBySportEvent(sportEventId);
    const match = this.requireMatch(sportEventId, bracket, matchNumber);
    if (match.status !== MatchStatus.COMPLETED) {
      return bracket;
    }
    this.assertNextMatchOpen(sportEventId, bracket, match);
    const result = { id: match.id, status: MatchStatus.SCHEDULED, winnerSide: null, homeScore: null, awayScore: null, ...NO_SHOOTOUT };
    await this.write(sportEventId, bracket, result, this.advance(bracket, match, null));
    this.deps.logger?.info({ sportEventId, matchNumber }, 'Cleared a match result');
    return this.deps.matches.findBySportEvent(sportEventId);
  }

  /**
   * Cancels one game of a released event that was never played (#715, design Q5.9): a postponed
   * regular-season game is cancelled in its week and added to the week it moves to while that week
   * is still a draft. A cancelled game counts for no pick and no standing. Cancelling a cancelled
   * game changes nothing. 404 BRACKET_MATCH_NOT_FOUND; 409 MATCH_ALREADY_PLAYED for a game with a
   * result; 422 MATCH_IN_BRACKET for a game of a bracket (it sends its winner on, takes a team from
   * an earlier game, or sits among games of several rounds), since a bracket cannot lose a game.
   */
  async cancelMatch(sportEventId: string, matchNumber: number): Promise<SportEventMatch[]> {
    const sportEvent = await this.requireReleasedBracketEvent(sportEventId);
    const bracket = await this.deps.matches.findBySportEvent(sportEventId);
    const match = this.requireMatch(sportEventId, bracket, matchNumber);
    if (match.status === MatchStatus.CANCELLED) {
      return bracket;
    }
    if (match.status === MatchStatus.COMPLETED) {
      this.deps.logger?.warn({ sportEventId, matchNumber }, 'Refused to cancel a game that has a result');
      throw new SportEventError(
        `Match ${matchNumber} has a result: clear it before cancelling the game.`,
        'MATCH_ALREADY_PLAYED',
        409,
      );
    }
    // A reseeded bracket links no games, but its games still span several rounds.
    if (!formsNoBracket(bracket, linksOn)) {
      this.deps.logger?.warn({ sportEventId, matchNumber }, 'Refused to cancel a bracket game');
      throw new SportEventError(
        `Match ${matchNumber} is part of a bracket, which cannot lose a game: change its time instead.`,
        'MATCH_IN_BRACKET',
        422,
      );
    }
    const result = { id: match.id, status: MatchStatus.CANCELLED, winnerSide: null, homeScore: null, awayScore: null, ...NO_SHOOTOUT };
    await this.write(sportEventId, bracket, result, null);
    this.deps.logger?.info({ sportEventId, matchNumber }, 'Cancelled a game');
    // A squares contest on the game ends Final with no scores (#711, #743).
    await this.deps.contestActivation?.settleContestsForFinishedGame(sportEvent, match.id, this.deps.now?.() ?? new Date());
    return this.deps.matches.findBySportEvent(sportEventId);
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
  async recordPeriodScore(sportEventId: string, matchNumber: number, periodNumber: number, input: PeriodScoreInput): Promise<SportEventMatch[]> {
    const { sportEvent, match, periods } = await this.requirePeriod(sportEventId, matchNumber, periodNumber);
    if (match.homeSportEventParticipantId === null || match.awaySportEventParticipantId === null) {
      this.deps.logger?.warn({ sportEventId, matchNumber, periodNumber }, 'Refused a period score for a game whose teams are not both known');
      throw new SportEventError(
        `Match ${matchNumber} does not have both teams yet, so it has no score.`,
        'MATCH_SIDES_NOT_SET',
        422,
      );
    }
    const problem = describePeriodScoreProblem(match, periodNumber, input, periods);
    if (problem) {
      this.deps.logger?.warn({ sportEventId, matchNumber, periodNumber, problem }, 'Refused a period score out of step with the game\'s other scores');
      throw new SportEventError(
        `The score at the end of ${periods.label.one} ${periodNumber} of match ${matchNumber} cannot be saved: ${problem}.`,
        'MATCH_PERIOD_SCORE_INVALID',
        422,
      );
    }
    await this.deps.matches.savePeriodScore(match.id, { periodNumber, ...input });
    this.deps.logger?.info({ sportEventId, matchNumber, periodNumber }, 'Saved a period score');
    // A scored period means the game is under way: a squares contest on it goes live (#711).
    const now = this.deps.now?.() ?? new Date();
    if (sportEvent.status === SportEventStatus.IN_PROGRESS) {
      await this.deps.contestActivation?.activateContestsPastCutoff(sportEvent, now);
    }
    // A quarter entered after the result may be the last one a squares contest waits for.
    if (match.status === MatchStatus.COMPLETED) {
      await this.deps.contestActivation?.settleContestsForFinishedGame(sportEvent, match.id, now);
    }
    return this.deps.matches.findBySportEvent(sportEventId);
  }

  /**
   * Clears the score at the end of one period of a game. Clearing one that is not entered changes
   * nothing. The refusals of `recordPeriodScore` for the event, the period and the match.
   */
  async clearPeriodScore(sportEventId: string, matchNumber: number, periodNumber: number): Promise<SportEventMatch[]> {
    const { match } = await this.requirePeriod(sportEventId, matchNumber, periodNumber);
    if (!match.periodScores.some((score) => score.periodNumber === periodNumber)) {
      return this.deps.matches.findBySportEvent(sportEventId);
    }
    await this.deps.matches.deletePeriodScore(match.id, periodNumber);
    this.deps.logger?.info({ sportEventId, matchNumber, periodNumber }, 'Cleared a period score');
    return this.deps.matches.findBySportEvent(sportEventId);
  }

  /** A released event's game, of a sport with periods, and a period of it before the last. */
  private async requirePeriod(
    sportEventId: string,
    matchNumber: number,
    periodNumber: number,
  ): Promise<{ sportEvent: SportEvent; match: SportEventMatch; periods: SportMatchPeriods }> {
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
      this.deps.logger?.warn({ sportEventId, matchNumber, periodNumber }, 'Refused a score for the last period or past it');
      throw new SportEventError(
        `A game has ${periods.count} ${periods.label.many}, and the score at the end of the last is the final score: enter it as the game's result.`,
        'MATCH_PERIOD_INVALID',
        422,
      );
    }
    const match = this.requireMatch(sportEventId, await this.deps.matches.findBySportEvent(sportEventId), matchNumber);
    if (match.status === MatchStatus.CANCELLED) {
      this.deps.logger?.warn({ sportEventId, matchNumber }, 'Refused a period score for a cancelled game');
      throw new SportEventError(`Match ${matchNumber} was cancelled, so it has no score.`, 'MATCH_CANCELLED', 409);
    }
    return { sportEvent, match, periods };
  }

  /**
   * The side of the next match the result puts `rowId` on, or empties; null for the final, and for
   * a match before a reseed whose winner is not placed yet.
   */
  private advance(bracket: readonly SportEventMatch[], match: SportEventMatch, rowId: string | null): MatchSideFill | null {
    if (match.advancesToMatchId !== null && match.advancesToSide !== null) {
      return { id: match.advancesToMatchId, side: match.advancesToSide, sportEventParticipantId: rowId };
    }
    const placed = placementOf(bracket, match);
    return placed ? { id: placed.match.id, side: placed.side, sportEventParticipantId: rowId } : null;
  }

  private async write(
    sportEventId: string,
    bracket: readonly SportEventMatch[],
    result: Pick<SportEventMatch, 'id' | 'status' | 'winnerSide' | 'homeScore' | 'awayScore' | 'homeShootoutScore' | 'awayShootoutScore'>,
    sideFill: MatchSideFill | null,
  ): Promise<void> {
    // The standings are read off the bracket as it will stand after this write.
    const after = bracket.map((candidate) => {
      if (candidate.id === result.id) return { ...candidate, ...result };
      if (sideFill && candidate.id === sideFill.id) {
        return sideFill.side === MatchSide.HOME
          ? { ...candidate, homeSportEventParticipantId: sideFill.sportEventParticipantId }
          : { ...candidate, awaySportEventParticipantId: sideFill.sportEventParticipantId };
      }
      return candidate;
    });
    const asOf = (this.deps.now ?? (() => new Date()))();
    const standings = formsNoBracket(after, linksOn) ? gameStandings(after, asOf) : bracketStandings(after, asOf);
    await this.deps.matches.applyResult({ result, sideFill, standings });
    this.deps.logger?.debug({ sportEventId, matchId: result.id }, 'Rewrote the event standings');
  }

  private assertNextMatchOpen(sportEventId: string, bracket: readonly SportEventMatch[], match: SportEventMatch): void {
    const next = bracket.find((candidate) => candidate.id === match.advancesToMatchId) ?? placementOf(bracket, match)?.match;
    // A quarter score belongs to the two teams playing (#772), so a next match with one is locked
    // as one with a result is: changing who plays it would leave the score on another pairing.
    if (next && (next.status === MatchStatus.COMPLETED || next.periodScores.length > 0)) {
      this.deps.logger?.warn({ sportEventId, matchNumber: match.matchNumber, nextMatchNumber: next.matchNumber }, 'Refused a match result change after the next match was decided or scored');
      throw new SportEventError(
        next.status === MatchStatus.COMPLETED
          ? `Match ${match.matchNumber}'s winner already played match ${next.matchNumber}, which has a result: clear match ${next.matchNumber}'s result first.`
          : `Match ${match.matchNumber}'s winner is playing match ${next.matchNumber}, which has scores entered: clear them first.`,
        'SPORT_EVENT_MATCH_RESULT_LOCKED',
        409,
      );
    }
  }

  private requireMatch(sportEventId: string, bracket: readonly SportEventMatch[], matchNumber: number): SportEventMatch {
    const match = bracket.find((candidate) => candidate.matchNumber === matchNumber);
    if (!match) {
      throw new SportEventError(`Sport event ${sportEventId} has no match ${matchNumber}.`, 'BRACKET_MATCH_NOT_FOUND', 404);
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
    if (!sportPlaysMatches(event.sport)) {
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

/**
 * Where a reseed placed the winner of a match that links nowhere: the next round's match naming it, and
 * the side. Undefined for a match without a result, or a winner not placed yet.
 */
function placementOf(bracket: readonly SportEventMatch[], match: SportEventMatch): { match: SportEventMatch; side: MatchSide } | undefined {
  if (match.advancesToMatchId !== null || match.status !== MatchStatus.COMPLETED || match.winnerSide === null) return undefined;
  const winnerId = sideRowId(match, match.winnerSide);
  for (const later of bracket) {
    if (later.roundNumber !== match.roundNumber + 1) continue;
    for (const side of [MatchSide.HOME, MatchSide.AWAY]) {
      if (sideRowId(later, side) === winnerId) return { match: later, side };
    }
  }
  return undefined;
}

/** Where a result is entered: in a bracket or a week of games, and how the sport settles a level knockout. */
export interface ScoreRules {
  inBracket: boolean;
  shootout: SportShootout | null;
}

/**
 * What is wrong with a result's scores, or null. Both scores or neither, and the winner's the
 * higher; except that a bracket match of a sport settled by shoot-out (#791) may be level, its
 * winner named by both shoot-out scores, the winner's the higher. Shoot-out scores are refused
 * anywhere else, and on a result that is not level. A tie (#792) is only for a game of a week,
 * and needs both scores, level.
 */
export function describeScoreProblem(
  { winnerSide, homeScore, awayScore }: Pick<MatchResultInput, 'winnerSide' | 'homeScore' | 'awayScore'>,
  { homeShootoutScore, awayShootoutScore }: Pick<SportEventMatch, 'homeShootoutScore' | 'awayShootoutScore'>,
  rules: ScoreRules,
): string | null {
  const hasShootout = homeShootoutScore !== null || awayShootoutScore !== null;
  if (hasShootout && (!rules.shootout || !rules.inBracket)) {
    return rules.shootout ? 'only a bracket match is settled by a shoot-out' : 'this sport has no shoot-outs';
  }
  if (winnerSide === null) {
    if (rules.inBracket) return 'a bracket match always has a winner';
    return homeScore !== null && awayScore !== null && homeScore === awayScore ? null : 'a tie needs both scores, level';
  }
  if (homeScore === null && awayScore === null) {
    return hasShootout ? 'a shoot-out needs the score after extra time, level' : null;
  }
  if (homeScore === null || awayScore === null) return 'give both scores or neither';
  const winnerFirst = <T>(home: T, away: T): [T, T] => (winnerSide === MatchSide.HOME ? [home, away] : [away, home]);
  const [winner, loser] = winnerFirst(homeScore, awayScore);
  if (homeScore !== awayScore) {
    if (hasShootout) return 'a shoot-out is only held after a level score';
    return winner > loser ? null : 'the winner\'s score must be higher than the loser\'s';
  }
  if (!rules.shootout || !rules.inBracket) return 'the winner\'s score must be higher than the loser\'s';
  if (homeShootoutScore === null || awayShootoutScore === null) return 'a level score needs both shoot-out scores';
  const [winnerKicks, loserKicks] = winnerFirst(homeShootoutScore, awayShootoutScore);
  return winnerKicks > loserKicks ? null : 'the winner\'s shoot-out score must be higher than the loser\'s';
}

/**
 * What is wrong with the score at the end of `periodNumber`, or null. A scoreboard's score never
 * goes down, so neither side's may be below its score at the end of an earlier period, or above
 * its score at the end of a later one or its final score (overtime included).
 */
export function describePeriodScoreProblem(
  match: Pick<SportEventMatch, 'periodScores' | 'status' | 'homeScore' | 'awayScore'>,
  periodNumber: number,
  score: PeriodScoreInput,
  periods: SportMatchPeriods,
): string | null {
  const below = (left: PeriodScoreInput, right: PeriodScoreInput) => left.homeScore < right.homeScore || left.awayScore < right.awayScore;
  for (const other of match.periodScores) {
    if (other.periodNumber < periodNumber && below(score, other)) {
      return `a side's score is lower than at the end of ${periods.label.one} ${other.periodNumber}`;
    }
    if (other.periodNumber > periodNumber && below(other, score)) {
      return `a side's score is higher than at the end of ${periods.label.one} ${other.periodNumber}`;
    }
  }
  if (match.status === MatchStatus.COMPLETED && match.homeScore !== null && match.awayScore !== null
    && below({ homeScore: match.homeScore, awayScore: match.awayScore }, score)) {
    return 'a side\'s score is higher than its final score';
  }
  return null;
}

/** A final score below a side's score at the end of an entered period, or null when it fits them all. */
function describeFinalBelowPeriods(
  match: Pick<SportEventMatch, 'periodScores'>,
  { homeScore, awayScore }: MatchResultInput,
  periods: SportMatchPeriods | undefined,
): string | null {
  if (homeScore === null || awayScore === null || !periods) return null;
  const higher = match.periodScores.find((period) => period.homeScore > homeScore || period.awayScore > awayScore);
  return higher ? `a side's final score is lower than at the end of ${periods.label.one} ${higher.periodNumber}` : null;
}

