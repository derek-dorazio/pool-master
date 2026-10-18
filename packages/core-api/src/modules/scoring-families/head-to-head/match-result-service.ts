/**
 * MatchResultService — the admin's results for a bracket event (#699, plans/knockout-and-pickem-design.md
 * §3.3), the head-to-head counterpart of racing's finishing order. The admin marks a match's winner,
 * with both scores or neither (a series' score is games won); saving it, all or none:
 *
 * - completes the match with its winner and scores,
 * - puts the winner on the side of the match it advances to,
 * - and rewrites every team's core standing from the bracket: champion 1, runner-up 2, teams out in
 *   the same round sharing a place below everyone who went further, a team that lost ELIMINATED,
 *   and `currentRound` the latest round the team has a match in.
 *
 * A result can be changed, or cleared, until the match its winner advanced to has a result of its
 * own (409 SPORT_EVENT_MATCH_RESULT_LOCKED): changing an early winner then would leave the later
 * match between the wrong teams, so the admin clears the later result first. Fixing only the
 * scores never moves a team and is always allowed.
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
  ParticipantStandingStatus,
  SportEventStatus,
  compareScores,
  getSportDefinition,
  rankSortedScores,
  sportPlaysBracket,
  type SportEvent,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { SportEventError } from '../../events/errors';

export interface MatchResultInput {
  winnerSide: MatchSide;
  /** Both scores or neither: the winner's must be the higher. */
  homeScore: number | null;
  awayScore: number | null;
}

export interface MatchResultServiceDeps {
  sportEvents: Pick<SportEventRepository, 'findById'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent' | 'applyResult'>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

function sideRowId(match: Pick<SportEventMatch, 'homeSportEventParticipantId' | 'awaySportEventParticipantId'>, side: MatchSide): string | null {
  return side === MatchSide.HOME ? match.homeSportEventParticipantId : match.awaySportEventParticipantId;
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
   * Enters or changes one match's result. 404 BRACKET_MATCH_NOT_FOUND; 422 MATCH_SIDES_NOT_SET while
   * a side still waits for its team; 422 MATCH_RESULT_INVALID for one score without the other, or
   * scores the winner did not win by; 409 SPORT_EVENT_MATCH_RESULT_LOCKED for a new winner once the
   * next match has a result.
   */
  async recordResult(sportEventId: string, matchNumber: number, input: MatchResultInput): Promise<SportEventMatch[]> {
    await this.requireReleasedBracketEvent(sportEventId);
    const bracket = await this.deps.matches.findBySportEvent(sportEventId);
    const match = this.requireMatch(sportEventId, bracket, matchNumber);
    const winnerId = sideRowId(match, input.winnerSide);
    const loserId = sideRowId(match, input.winnerSide === MatchSide.HOME ? MatchSide.AWAY : MatchSide.HOME);
    if (winnerId === null || loserId === null) {
      this.deps.logger?.warn({ sportEventId, matchNumber }, 'Refused a result for a match whose teams are not both known');
      throw new SportEventError(
        `Match ${matchNumber} does not have both teams yet: enter the results of the matches that feed it first.`,
        'MATCH_SIDES_NOT_SET',
        422,
      );
    }
    const scoreProblem = describeScoreProblem(input);
    if (scoreProblem) {
      this.deps.logger?.warn({ sportEventId, matchNumber, scoreProblem }, 'Refused a match result with invalid scores');
      throw new SportEventError(`Match ${matchNumber}'s result cannot be saved: ${scoreProblem}.`, 'MATCH_RESULT_INVALID', 422);
    }
    const winnerChanges = match.status !== MatchStatus.COMPLETED || match.winnerSide !== input.winnerSide;
    if (winnerChanges) {
      this.assertNextMatchOpen(sportEventId, bracket, match);
    }

    const result = { id: match.id, status: MatchStatus.COMPLETED, winnerSide: input.winnerSide, homeScore: input.homeScore, awayScore: input.awayScore };
    const sideFill = this.advance(bracket, match, winnerId);
    await this.write(sportEventId, bracket, result, sideFill);
    this.deps.logger?.info({ sportEventId, matchNumber, winnerSide: input.winnerSide, winnerChanges }, 'Saved a match result');
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
    const result = { id: match.id, status: MatchStatus.SCHEDULED, winnerSide: null, homeScore: null, awayScore: null };
    await this.write(sportEventId, bracket, result, this.advance(bracket, match, null));
    this.deps.logger?.info({ sportEventId, matchNumber }, 'Cleared a match result');
    return this.deps.matches.findBySportEvent(sportEventId);
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
    result: Pick<SportEventMatch, 'id' | 'status' | 'winnerSide' | 'homeScore' | 'awayScore'>,
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
    await this.deps.matches.applyResult({ result, sideFill, standings: bracketStandings(after, asOf) });
    this.deps.logger?.debug({ sportEventId, matchId: result.id }, 'Rewrote bracket standings');
  }

  private assertNextMatchOpen(sportEventId: string, bracket: readonly SportEventMatch[], match: SportEventMatch): void {
    const next = bracket.find((candidate) => candidate.id === match.advancesToMatchId) ?? placementOf(bracket, match)?.match;
    if (next?.status === MatchStatus.COMPLETED) {
      this.deps.logger?.warn({ sportEventId, matchNumber: match.matchNumber, nextMatchNumber: next.matchNumber }, 'Refused a match result change after the next match was decided');
      throw new SportEventError(
        `Match ${match.matchNumber}'s winner already played match ${next.matchNumber}, which has a result: clear match ${next.matchNumber}'s result first.`,
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
    if (!sportPlaysBracket(event.sport)) {
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

/** What is wrong with a result's scores, or null: both or neither, and the winner's the higher. */
function describeScoreProblem({ winnerSide, homeScore, awayScore }: MatchResultInput): string | null {
  if (homeScore === null && awayScore === null) return null;
  if (homeScore === null || awayScore === null) return 'give both scores or neither';
  const [winner, loser] = winnerSide === MatchSide.HOME ? [homeScore, awayScore] : [awayScore, homeScore];
  return winner > loser ? null : 'the winner\'s score must be higher than the loser\'s';
}
