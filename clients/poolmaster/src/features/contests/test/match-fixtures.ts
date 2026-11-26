import { HomeAway, MatchEnding, MatchSide, MatchSideOutcome, MatchStatus, PeriodKind, SlotKind } from '@poolmaster/shared/domain';
import type { SportEventRoundMatchDto } from '@/lib/api';
import { roundSlot } from './round-slots';

/** Side 1 and side 2: a synced game has its away team on side 1 and its home team on side 2. */
const AWAY_SIDE = 1;
const HOME_SIDE = 2;

/**
 * A game as a test describes it, by its home and away teams: the fixture puts the away team on
 * side 1 and the home team on side 2, as a synced game has them (#2184).
 */
export interface HomeAwayMatchFixture extends Partial<Omit<SportEventRoundMatchDto, 'sides' | 'games'>> {
  home?: string | null;
  away?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  /** The winner; left out, the higher score's side once COMPLETED, and a tie on level scores. */
  winnerSide?: MatchSide | null;
  homeShootoutScore?: number | null;
  awayShootoutScore?: number | null;
  /** The running regulation score at each period's end. */
  periodScores?: Array<{ periodNumber: number; homeScore: number; awayScore: number }>;
  /** The home side's spread, as the game is quoted: -3.5 has the home team favoured. */
  homeSpread?: number | null;
}

function outcomeOf(status: MatchStatus, winner: MatchSide | null, side: MatchSide): MatchSideOutcome {
  if (status !== MatchStatus.COMPLETED) return MatchSideOutcome.PENDING;
  if (winner === null) return MatchSideOutcome.TIED;
  return winner === side ? MatchSideOutcome.WON : MatchSideOutcome.LOST;
}

function winnerOf(homeScore: number | null, awayScore: number | null): MatchSide | null {
  if (homeScore === null || awayScore === null || homeScore === awayScore) return null;
  return homeScore > awayScore ? MatchSide.HOME : MatchSide.AWAY;
}

/** A game of an event as the contract carries it, on its sides. */
export function homeAwayMatchFixture({
  home = null,
  away = null,
  homeScore = null,
  awayScore = null,
  winnerSide,
  homeShootoutScore = null,
  awayShootoutScore = null,
  periodScores = [],
  homeSpread = null,
  ...overrides
}: HomeAwayMatchFixture = {}): SportEventRoundMatchDto {
  const status = overrides.status ?? MatchStatus.SCHEDULED;
  const isNeutralSite = overrides.isNeutralSite ?? false;
  const winner = winnerSide === undefined ? winnerOf(homeScore, awayScore) : winnerSide;
  const side = (sideNumber: number, matchSide: MatchSide, team: string | null, score: number | null) => ({
    sideNumber,
    sportEventParticipantId: team,
    outcome: outcomeOf(status, winner, matchSide),
    score,
    // The spread is held on side 1 only, the away side: the home spread turned round.
    spread: sideNumber === AWAY_SIDE && homeSpread !== null ? -homeSpread : null,
  });
  const result = (sideNumber: number, homeAway: HomeAway, score: number | null, shootoutScore: number | null, own: 'homeScore' | 'awayScore') => ({
    sideNumber,
    score,
    homeAway: isNeutralSite ? HomeAway.NONE : homeAway,
    shootoutScore,
    periodScores: periodScores.map((period) => ({ kind: PeriodKind.REGULAR, periodNumber: period.periodNumber, score: period[own] })),
  });
  return {
    id: 'game-1',
    sportEventId: 'event-1',
    roundNumber: 1,
    slot: roundSlot(SlotKind.WEEK, null),
    matchNumber: 1,
    scheduledDate: null,
    ending: MatchEnding.PLAYED,
    completedAt: null,
    advancesTo: null,
    regionLabel: null,
    ...overrides,
    isNeutralSite,
    status,
    // As the server's mapper reads them from the status.
    isUnplayed: overrides.isUnplayed ?? (status === MatchStatus.SCHEDULED || status === MatchStatus.POSTPONED),
    isFinal: overrides.isFinal ?? status === MatchStatus.COMPLETED,
    sides: [side(AWAY_SIDE, MatchSide.AWAY, away, awayScore), side(HOME_SIDE, MatchSide.HOME, home, homeScore)],
    games: [{
      gameNumber: 1,
      status,
      isFinal: status === MatchStatus.COMPLETED,
      scheduledDate: overrides.scheduledDate ?? null,
      sideResults: [
        result(AWAY_SIDE, HomeAway.AWAY, awayScore, awayShootoutScore, 'awayScore'),
        result(HOME_SIDE, HomeAway.HOME, homeScore, homeShootoutScore, 'homeScore'),
      ],
    }],
  };
}
