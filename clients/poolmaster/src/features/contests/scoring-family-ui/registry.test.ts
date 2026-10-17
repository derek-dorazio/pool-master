import { describe, expect, it } from 'vitest';
import {
  getSportDefinition,
  ScoringFamily,
  Sport,
  SUPPORTED_SPORTS,
} from '@poolmaster/shared/domain';
import type {
  ContestEntryStandingDto,
  ContestLeaderboardResponse,
  ScoredContestEntryPickDto,
  SportEventParticipantDto,
} from '@/lib/api';
import { buildLeaderboardView } from '../contest-leaderboard';
import { getScoringFamilyUi, SCORING_FAMILY_UI } from './registry';
import { strokePlayUi } from './stroke-play';

const golf = getSportDefinition(Sport.GOLF);

const cutGolfer: SportEventParticipantDto = {
  id: 'sep-1',
  sportEventId: 'event-1',
  participantId: 'participant-1',
  isActive: true,
  inactiveReason: null,
  ranking: null,
  oddsToWin: null,
  seedNumber: null,
  participant: {
    id: 'participant-1',
    sportId: 'sport-golf',
    name: 'Cut Golfer',
    participantType: 'INDIVIDUAL',
    status: 'ACTIVE',
    injuryStatus: { status: 'HEALTHY' },
    externalIds: {},
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  },
  valuation: null,
  standing: null,
  rounds: [],
  race: null,
  affiliatedWithSportLeague: true,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
};

/** A pick on the cut golfer whose rounds 1 and 2 count as 80 strokes. */
const unplayedPick: ScoredContestEntryPickDto = {
  pickId: 'pick-1',
  sportEventParticipantId: 'sep-1',
  pickedAt: '2026-04-01T00:00:00.000Z',
  slot: null,
  isCounting: true,
  isDropped: false,
  golf: { scoreToPar: 16, unplayedRoundNumbers: [1, 2] },
  race: null,
  knockout: null,
};

const entry: ContestEntryStandingDto = {
  entryId: 'entry-1',
  entryName: 'Entry 1',
  entryNumber: 1,
  squadId: 'squad-1',
  squadName: 'Squad',
  status: 'SUBMITTED',
  position: 1,
  displayPosition: '1',
  countingPickLimit: 1,
  scoredPickCount: 1,
  totalScore: 16,
  picks: [unplayedPick],
};

const golfLeaderboard: ContestLeaderboardResponse = {
  contestId: 'contest-1',
  sportEventId: 'event-1',
  sport: 'GOLF',
  scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
  countingRule: { type: 'BEST_N', count: 1 },
  participants: [cutGolfer],
  entries: [entry],
  asOf: null,
};

describe('SCORING_FAMILY_UI', () => {
  it('resolves golf to the stroke-play entry through its sport definition', () => {
    expect(golf.scoringFamily).toBe(ScoringFamily.STROKE_PLAY);
    expect(getScoringFamilyUi(golf)).toBe(strokePlayUi);
  });

  it('has an entry for every supported sport\'s scoring family, so no leaderboard resolves to nothing', () => {
    for (const sport of SUPPORTED_SPORTS) {
      expect(SCORING_FAMILY_UI[getSportDefinition(sport).scoringFamily]).toBeDefined();
    }
  });
});

describe('stroke-play leaderboard', () => {
  it('heads golf\'s columns after the total with Thr, then R1, R2 for each round on the board', () => {
    const board = strokePlayUi.leaderboard(golfLeaderboard, golf);

    expect(board.detailColumns.map((column) => column.label)).toEqual(['Thr', 'R1', 'R2']);
  });

  it('formats the entry and pick totals against par through the scoring definition', () => {
    const board = strokePlayUi.leaderboard(golfLeaderboard, golf);

    expect(buildLeaderboardView(golfLeaderboard).entries[0].total).toBe('+16');
    expect(board.pickDetail('entry-1', unplayedPick, cutGolfer).total).toBe('+16');
  });

  it('shows 80 in an unplayed round and names that round with the sport\'s own round label', () => {
    const board = strokePlayUi.leaderboard(golfLeaderboard, {
      ...golf,
      roundLabel: (roundNumber) => `Day ${roundNumber}`,
    });

    const [, firstRound] = board.pickDetail('entry-1', unplayedPick, cutGolfer).detailCells;

    expect(firstRound.text).toBe('80');
    expect(firstRound.unplayed?.ariaLabel).toBe('Day 1 not played, counts as 80 strokes');
  });

  it('explains the 80s in a footnote only when a pick on the board has an unplayed round', () => {
    expect(strokePlayUi.leaderboard(golfLeaderboard, golf).footnote?.testId)
      .toBe('contest-leaderboard-unplayed-note');
    expect(strokePlayUi.leaderboard({ ...golfLeaderboard, entries: [] }, golf).footnote).toBeNull();
  });
});
