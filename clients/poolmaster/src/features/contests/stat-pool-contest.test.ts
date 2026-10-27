import { describe, expect, it } from 'vitest';
import { getSportDefinition, ParticipantType, ScoringFamily, SelectionType, Sport, SUPPORTED_SPORTS, eventSportDefinition } from '@poolmaster/shared/domain';
import { contestEventsFor } from './contest-template-events';
import { contestEntryTiebreaker, contestRosterParticipantNoun, contestSportDefinition, participantAffiliation } from './contest-sport';
import { STAT_POOL_FORMULAS, statPoolContestName, statPoolScoringLine } from './scoring-family-ui/stat-pool-copy';
import { buildContest, buildContestSportEvent, buildSportEvent } from './test/contest-admin-fixtures';

// A championship stat pool's contest screens (#936): the World Series is baseball, but its events
// play the composite with players, so every screen reads the event's definition, not the sport's.

const statPool = { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.COMPOSITE } as const;

describe('a stat pool contest\'s definition', () => {
  it('is the stat pool\'s for a World Series contest, its players named as players and no tiebreaker asked, while a golf contest keeps golf\'s', () => {
    const worldSeries = buildContest({ sport: Sport.BASEBALL, sportEvents: [buildContestSportEvent(statPool)] });
    const masters = buildContest({ sport: Sport.GOLF });

    expect(contestSportDefinition(worldSeries)?.scoringFamily).toBe(ScoringFamily.COMPOSITE);
    expect(contestRosterParticipantNoun(worldSeries)).toEqual({ one: 'player', many: 'players' });
    expect(contestEntryTiebreaker(worldSeries)).toBeNull();
    expect(contestRosterParticipantNoun(masters).one).toBe('golfer');
    expect(contestEntryTiebreaker(masters)?.label).toBe('Winning Score Relative to Par');
  });

  it('is none for a contest with no sport', () => {
    expect(contestSportDefinition(buildContest({ sport: null }))).toBeNull();
  });
});

describe('the events Create contest offers a format on', () => {
  const postseason = buildSportEvent({ id: 'mlb-postseason', sport: Sport.BASEBALL, name: 'MLB Postseason' });
  const worldSeries = buildSportEvent({ id: 'world-series', sport: Sport.BASEBALL, name: 'World Series', ...statPool });

  it('leaves a stat pool event out of a bracket, which only baseball\'s postseason plays', () => {
    expect(contestEventsFor([postseason, worldSeries], SelectionType.BRACKET).map((event) => event.id)).toEqual(['mlb-postseason']);
  });

  it('offers a stat pool event for its tiered, budget and quick pick formats', () => {
    for (const format of [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW]) {
      expect(contestEventsFor([worldSeries], format).map((event) => event.id)).toEqual(['world-series']);
    }
  });
});

describe('a roster row\'s second line', () => {
  it('names a stat pool player\'s team and position together, a team alone, and nothing for a participant with no team', () => {
    expect(participantAffiliation({ team: 'Los Angeles Dodgers', role: 'SS' })).toBe('Los Angeles Dodgers · SS');
    expect(participantAffiliation({ team: 'Red Bull Racing', role: null })).toBe('Red Bull Racing');
    expect(participantAffiliation({ team: null, role: 'GOLFER' })).toBeNull();
  });
});

describe('how a stat pool scores, in words', () => {
  it('has a formula for exactly the sports with a composite, so no stat pool shows a blank one', () => {
    for (const sport of SUPPORTED_SPORTS) {
      expect([sport, STAT_POOL_FORMULAS[sport] !== null]).toEqual([sport, getSportDefinition(sport).composite !== null]);
    }
  });

  it('names the composite and its formula for a stat pool, and nothing for the sport\'s own events', () => {
    expect(statPoolScoringLine(eventSportDefinition({ sport: Sport.BASEBALL, ...statPool })))
      .toBe('Box Score: total bases + runs + RBI + walks + stolen bases, each game.');
    expect(statPoolScoringLine(eventSportDefinition({ sport: Sport.HOCKEY, ...statPool })))
      .toBe('Power Play: 2 × goals + assists + shots on goal, each game.');
    expect(statPoolScoringLine(getSportDefinition(Sport.BASEBALL))).toBeNull();
  });
});

describe('a Clutch Card contest\'s suggested name', () => {
  it('is the event\'s name and Stars, a single final without the word: World Series, NBA Finals, Stanley Cup, Super Bowl, Championship Weekend, CFP Semifinals, CFP National Championship, Men\'s Final Four, Men\'s National Championship, NBA Conference Finals, NHL Conference Finals, League Championship Series and Men\'s Frozen Four Stars', () => {
    expect(['World Series', 'NBA Finals', 'Stanley Cup Final', 'Super Bowl', 'Championship Weekend', 'CFP Semifinals', 'CFP National Championship',
      'Men\'s Final Four', 'Men\'s National Championship', 'NBA Conference Finals', 'NHL Conference Finals', 'League Championship Series', 'Men\'s Frozen Four'].map(statPoolContestName)).toEqual([
      'World Series Stars', 'NBA Finals Stars', 'Stanley Cup Stars', 'Super Bowl Stars', 'Championship Weekend Stars',
      'CFP Semifinals Stars', 'CFP National Championship Stars',
      'Men\'s Final Four Stars', 'Men\'s National Championship Stars', 'NBA Conference Finals Stars', 'NHL Conference Finals Stars', 'League Championship Series Stars', 'Men\'s Frozen Four Stars',
    ]);
  });
});
