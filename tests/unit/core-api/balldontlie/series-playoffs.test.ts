import { describe, expect, it } from '@jest/globals';
import { ProviderGameState, Sport } from '@poolmaster/shared/domain';
import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import {
  parsePlayoffsScope,
  playoffsScopeId,
  toPlayoffsEvent,
  toPlayoffsEvents,
  toPlayoffsFieldParticipants,
  toPlayoffsGameScoreUpdates,
  type PlayoffGame,
  type PlayoffsLeague,
  type PlayoffTeam,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/series-playoffs';

// The league-neutral half of a series playoffs (#1496, #1545), on a made-up four-team league
// whose final is a best of three, so a whole bracket fits in a few games.
const LEAGUE: PlayoffsLeague = {
  key: 'tst',
  tour: 'TST',
  sport: Sport.BASKETBALL,
  eventName: 'Test Playoffs',
  rounds: [
    { name: 'Test Semifinals', seriesLength: 3, seriesCount: 2 },
    { name: 'Test Final', seriesLength: 3, seriesCount: 1 },
  ],
  playoffYearOffset: 1,
  seasonRolloverMonth: 8,
};

const team = (id: number): PlayoffTeam => ({ id, name: `Team ${String(id)}`, metadata: { abbreviation: `T${String(id)}` } });

let nextId = 1;
function game(day: number, home: number, away: number, homeScore: number | null, awayScore: number | null, state: CompetitionStatusState = CompetitionStatusState.FINAL, season = 2025): PlayoffGame {
  return { id: nextId++, season, postseason: true, start: Date.UTC(2026, 3, day), home: team(home), away: team(away), state, homeScore, awayScore };
}

/** Semifinals 1 v 4 and 2 v 3, each won 2-0 by the home side, then the final 1 v 2. */
function semifinals(): PlayoffGame[] {
  return [game(1, 1, 4, 100, 90), game(2, 2, 3, 99, 98), game(3, 4, 1, 80, 95), game(4, 3, 2, 70, 71)];
}

describe('series playoffs scopes', () => {
  it('names a season\'s postseason by the league\'s key and reads the season back, refusing another league\'s or an unrelated id', () => {
    expect(playoffsScopeId(LEAGUE, 2025)).toBe('tst-2025-postseason');
    expect(parsePlayoffsScope(LEAGUE, 'tst-2025-postseason')).toBe(2025);
    expect(parsePlayoffsScope(LEAGUE, 'nba-2025-postseason')).toBeNull();
    expect(parsePlayoffsScope(LEAGUE, 'tst-2025-week-3')).toBeNull();
  });
});

describe('toPlayoffsEvent', () => {
  it('spans the games, carries the league\'s tour and season, and is in progress while any game has started', () => {
    const event = toPlayoffsEvent(LEAGUE, 2025, [...semifinals(), game(9, 1, 2, null, null, CompetitionStatusState.SCHEDULED)], 4);

    expect(event).toMatchObject({
      externalId: 'tst-2025-postseason',
      sport: Sport.BASKETBALL,
      name: 'Test Playoffs',
      startDate: new Date(Date.UTC(2026, 3, 1)),
      endDate: new Date(Date.UTC(2026, 3, 9)),
      status: 'IN_PROGRESS',
      participantCount: 4,
      fieldLocked: true,
      metadata: { tour: 'TST', season: 2025 },
    });
  });

  it('stays in progress between rounds, when every listed game is final but the final has not been played', () => {
    expect(toPlayoffsEvent(LEAGUE, 2025, semifinals()).status).toBe('IN_PROGRESS');
  });

  it('stays in progress while the final series is still on, even with every game of it final so far', () => {
    expect(toPlayoffsEvent(LEAGUE, 2025, [...semifinals(), game(9, 1, 2, 90, 80)]).status).toBe('IN_PROGRESS');
  });

  it('completes once a side has won more than half of the final series, the series that starts last', () => {
    const games = [...semifinals(), game(9, 1, 2, 90, 80), game(10, 2, 1, 70, 60), game(11, 1, 2, 88, 81)];

    expect(toPlayoffsEvent(LEAGUE, 2025, games).status).toBe('COMPLETED');
  });

  it('counts no final win for a game called off, a final with no score or a level final, whatever order the games come in', () => {
    const final = [
      game(9, 1, 2, 90, 80),
      game(10, 2, 1, null, null, CompetitionStatusState.CANCELED),
      game(11, 1, 2, null, null),
      game(12, 2, 1, 75, 75),
    ];

    expect(toPlayoffsEvent(LEAGUE, 2025, [...final.reverse(), ...semifinals()]).status).toBe('IN_PROGRESS');
  });

  it('is scheduled, its field open, while no game has started', () => {
    const event = toPlayoffsEvent(LEAGUE, 2025, [game(1, 1, 4, 0, 0, CompetitionStatusState.SCHEDULED)]);

    expect(event).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
  });
});

describe('toPlayoffsEvents', () => {
  it('makes one event per season, earliest first', () => {
    const events = toPlayoffsEvents(LEAGUE, [game(1, 1, 4, null, null, CompetitionStatusState.SCHEDULED, 2026), ...semifinals()]
      .map((each, index) => (index === 0 ? { ...each, start: Date.UTC(2027, 3, 1) } : each)));

    expect(events.map((event) => event.externalId)).toEqual(['tst-2025-postseason', 'tst-2026-postseason']);
  });
});

describe('toPlayoffsFieldParticipants', () => {
  it('lists each team once, by the league\'s prefixed id, keeping its facts and the league\'s tour', () => {
    const participants = toPlayoffsFieldParticipants(LEAGUE, semifinals());

    expect(participants.map((participant) => participant.externalId)).toEqual(['tst-team-1', 'tst-team-4', 'tst-team-2', 'tst-team-3']);
    expect(participants[0]).toMatchObject({ name: 'Team 1', sport: Sport.BASKETBALL, active: true, metadata: { abbreviation: 'T1', tour: 'TST' } });
  });
});

describe('toPlayoffsGameScoreUpdates', () => {
  it('passes each game\'s teams, state and score, holds back the score of a game not under way, and leaves out a game in an unknown state', () => {
    const [final] = semifinals();
    const updates = toPlayoffsGameScoreUpdates(LEAGUE, [
      final,
      game(5, 1, 2, 40, 38, CompetitionStatusState.IN_PROGRESS),
      game(6, 2, 1, 0, 0, CompetitionStatusState.SCHEDULED),
      game(7, 2, 1, 0, 0, CompetitionStatusState.UNKNOWN),
    ]);

    expect(updates).toEqual([
      { externalGameId: String(final.id), homeTeamExternalId: 'tst-team-1', awayTeamExternalId: 'tst-team-4', state: ProviderGameState.FINAL, homeScore: 100, awayScore: 90 },
      expect.objectContaining({ state: ProviderGameState.IN_PROGRESS, homeScore: 40, awayScore: 38 }),
      expect.objectContaining({ state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null }),
    ]);
  });
});
