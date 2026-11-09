import {
  ContestEntryStatus,
  MatchStatus,
  PredictedResult,
  SportEventStatus,
  type SportEvent,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import type { ContestEntrySeasonPrediction, ContestEntryWithSquad } from '@poolmaster/shared/db';
import {
  loadSurvivorSeason,
  loadSurvivorWeeks,
  type SurvivorStandingsReadDeps,
} from '../../../packages/core-api/src/modules/contests/survivor-standings';

// The survivor season read straight from its ports (#785): how events become weeks, and how
// entries are ranked when the season holds an event with no games yet, or picks no week has.

const NOW = new Date('2026-09-20T00:00:00.000Z');

function week(id: string, startDate: Date, overrides: Partial<SportEvent> = {}): SportEvent {
  return { id, name: id, startDate, status: SportEventStatus.SCHEDULED, rounds: null, sport: 'AMERICAN_FOOTBALL', ...overrides } as SportEvent;
}

function game(id: string, sportEventId: string, roundNumber = 1): SportEventMatch {
  return { id, sportEventId, roundNumber, status: MatchStatus.SCHEDULED, scheduledDate: null, homeSportEventParticipantId: `${id}-home`, awaySportEventParticipantId: `${id}-away`, winnerSide: null } as SportEventMatch;
}

function entry(id: string, entryNumber: number, submittedFor: string[]): ContestEntryWithSquad {
  return {
    id, contestId: 'survivor', squadId: `squad-${id}`, squadName: `Squad ${id}`, entryNumber, name: `Entry ${id}`,
    events: submittedFor.map((sportEventId) => ({ sportEventId, status: ContestEntryStatus.SUBMITTED })),
    createdAt: NOW, updatedAt: NOW,
  };
}

function deps(events: SportEvent[], matches: SportEventMatch[], entries: ContestEntryWithSquad[] = [], predictions: ContestEntrySeasonPrediction[] = []): SurvivorStandingsReadDeps {
  return {
    sportEvents: { findByIds: async (ids) => events.filter((event) => ids.includes(event.id)) },
    matches: { findBySportEvents: async (ids) => matches.filter((match) => ids.includes(match.sportEventId)) },
    entries: { findByContestWithSquad: async () => entries },
    predictions: { findByEntriesAndEvents: async () => predictions },
  };
}

describe('loadSurvivorWeeks', () => {
  it('orders events that start together by id, and gives an event with no games yet one week of round 1', async () => {
    const kickoff = new Date('2026-09-27T17:00:00.000Z');
    const weeks = await loadSurvivorWeeks(
      deps([week('week-b', kickoff), week('week-a', kickoff)], [game('g1', 'week-a')]),
      { sportEventIds: ['week-b', 'week-a'] },
      NOW,
    );

    expect(weeks.map((each) => [each.weekNumber, each.event.id, each.roundNumber, each.roundCount, each.games.length])).toEqual([
      [1, 'week-a', 1, 1, 1],
      [2, 'week-b', 1, 1, 0],
    ]);
  });
});

describe('loadSurvivorSeason', () => {
  it('runs an entry with no picks through the season, and leaves out a pick on a game no week has', async () => {
    const started = week('week-1', new Date('2026-09-13T17:00:00.000Z'), { status: SportEventStatus.IN_PROGRESS });
    const stray = {
      id: 'stray', contestEntryId: 'picker', sportEventMatchId: 'not-a-week-game', sportEventId: 'week-1',
      predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'g1-home', participantId: 'p1', confidence: null,
    } as unknown as ContestEntrySeasonPrediction;

    const season = await loadSurvivorSeason(
      deps([started], [game('g1', 'week-1')], [entry('idle', 1, ['week-1']), entry('picker', 2, ['week-1'])], [stray]),
      { id: 'survivor', sportEventIds: ['week-1'] },
      NOW,
    );

    expect(season.entries.map((standing) => [standing.entry.id, standing.picks.size, standing.displayPosition])).toEqual([
      ['idle', 0, 'T1'],
      ['picker', 0, 'T1'],
    ]);
  });
});
