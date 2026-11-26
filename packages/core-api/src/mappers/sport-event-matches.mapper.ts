/**
 * Bracket mapper (#698) — an event's matches → their DTOs, dates as ISO strings.
 */

import {
  MatchResultSource,
  MatchSide,
  MatchStatus,
  PeriodKind,
  gameNumbered,
  isMatchUnplayed,
  matchCompletedAt,
  matchIsNeutralSite,
  matchScoreOf,
  matchSideOfSideNumber,
  matchSpread,
  runningPeriodScores,
  shootoutScoreOf,
  sideNumberOfMatchSide,
  sideParticipantId,
  winningSide,
  type SportEventRoundMatch,
  type SportEventRoundSlot,
} from '@poolmaster/shared/domain';
import type { RecordSportEventMatchPeriodScoreRequest, RecordSportEventRoundMatchResultRequest, SportEventRoundMatchDto, SportEventRoundSlotDto } from '@poolmaster/shared/dto/bracket.dto';
import type { MatchResultInput, PeriodScoreInput } from '../modules/scoring-families/head-to-head/match-result-service';

const HOME = sideNumberOfMatchSide(MatchSide.HOME);
const AWAY = sideNumberOfMatchSide(MatchSide.AWAY);

/**
 * A match for the wire, still named by home and away (#2046 part b moves it to sides): home is
 * side 2 and away side 1. Its score is its Games' (`matchScoreOf`), its period scores Game 1's
 * running totals (`runningPeriodScores`), and the spread, held on side 1, is turned to the home side.
 */
export function mapSportEventRoundMatchToDto(match: SportEventRoundMatch): SportEventRoundMatchDto {
  const gameOne = gameNumbered(match, 1);
  const winner = winningSide(match);
  const isFinal = match.status === MatchStatus.COMPLETED;
  return {
    id: match.id,
    sportEventId: match.sportEventId,
    roundNumber: match.roundNumber,
    slot: mapRoundSlotToDto(match.slot),
    matchNumber: match.matchNumber,
    homeSportEventParticipantId: sideParticipantId(match, HOME),
    awaySportEventParticipantId: sideParticipantId(match, AWAY),
    isNeutralSite: matchIsNeutralSite(match),
    scheduledDate: match.scheduledDate?.toISOString() ?? null,
    status: match.status,
    isFinal,
    isUnplayed: isMatchUnplayed(match.status),
    winnerSide: winner === null ? null : matchSideOfSideNumber(winner.sideNumber),
    homeScore: matchScoreOf(match, HOME),
    awayScore: matchScoreOf(match, AWAY),
    homeShootoutScore: gameOne === null ? null : shootoutScoreOf(gameOne, HOME),
    awayShootoutScore: gameOne === null ? null : shootoutScoreOf(gameOne, AWAY),
    ending: match.ending,
    // The feed is the only writer (#2074): a match with a result, a cancellation included, has it from the feed.
    resultSource: isFinal || match.status === MatchStatus.CANCELLED ? MatchResultSource.PROVIDER : null,
    completedAt: matchCompletedAt(match)?.toISOString() ?? null,
    advancesToMatchId: match.advancesToMatchId,
    advancesToSide: match.advancesToSideNumber === null ? null : matchSideOfSideNumber(match.advancesToSideNumber),
    regionLabel: match.regionLabel,
    homeSpread: homeSpreadOf(match),
    periodScores: gameOne === null ? [] : runningPeriodScores(gameOne)
      .filter((period) => period.kind === PeriodKind.REGULAR)
      .map(({ periodNumber, totals }) => ({ periodNumber, homeScore: totals.get(HOME) ?? 0, awayScore: totals.get(AWAY) ?? 0 })),
  };
}

/** The spread from the home side, as the API still gives it: side 1's spread is the away side's, so the home side's is its opposite. */
export function homeSpreadOf(match: Pick<SportEventRoundMatch, 'id' | 'sides'>): number | null {
  const spread = matchSpread(match);
  return spread === null ? null : 0 - spread;
}

/** The slot a round is played in, for the wire (#2006): its series length and pairing stay server-side. */
export function mapRoundSlotToDto({ seasonSlotId, name, slotKind, weekNumber, periods }: SportEventRoundSlot): SportEventRoundSlotDto {
  return { seasonSlotId, name, slotKind, weekNumber, periods: periods === null ? null : { unit: periods.unit, count: periods.count } };
}

/** A result request's home and away, as the result service takes them: by side number (home is side 2). */
export function toMatchResultInput({ winnerSide, homeScore, awayScore, homeShootoutScore, awayShootoutScore, ending }: RecordSportEventRoundMatchResultRequest): MatchResultInput {
  return {
    winnerSideNumber: winnerSide === null ? null : sideNumberOfMatchSide(winnerSide),
    sides: [
      { sideNumber: AWAY, score: awayScore, shootoutScore: awayShootoutScore ?? null },
      { sideNumber: HOME, score: homeScore, shootoutScore: homeShootoutScore ?? null },
    ],
    ...(ending !== undefined && { ending }),
  };
}

/** A period score request's home and away, by side number. */
export function toPeriodScoreInput({ homeScore, awayScore }: RecordSportEventMatchPeriodScoreRequest): PeriodScoreInput {
  return [{ sideNumber: AWAY, score: awayScore }, { sideNumber: HOME, score: homeScore }];
}
