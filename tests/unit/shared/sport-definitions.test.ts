import {
  PARTICIPANT_SCORING_DEFINITIONS,
  SPORT_DEFINITIONS,
  ScoringFamily,
  SelectionType,
  Sport,
  type SportDefinition,
  TournamentFormat,
  getDefaultTournamentFormatForSport,
  eventRoundLabel,
  getSportDefinition,
  getValidContestFormatsForTournamentFormat,
  sportAllowsSelectionType,
  sportPlaysBracket,
} from '@poolmaster/shared/domain';
import { getSelectionEngine } from '../../../packages/core-api/src/modules/selections/selection-engines/registry';

// The registry conformance suite (#602): every sport definition is checked here, so a sport
// added to the registry gets these checks without anyone writing them.

const definitions = Object.values(SPORT_DEFINITIONS);

describe.each(definitions.map((definition) => [definition.sport, definition] as const))('sport definition %s', (sport, definition) => {
  it('is registered under its own sport, and getSportDefinition returns it', () => {
    expect(SPORT_DEFINITIONS[sport].sport).toBe(sport);
    expect(getSportDefinition(sport)).toBe(definition);
  });

  it('allows only selection types that have an engine, each listed once', () => {
    expect(new Set(definition.selectionTypes).size).toBe(definition.selectionTypes.length);
    for (const selectionType of definition.selectionTypes) {
      expect(getSelectionEngine(selectionType).selectionType).toBe(selectionType);
    }
  });

  it('ranks only by scoring definitions that are declared with a direction', () => {
    for (const id of definition.scoringDefinitions) {
      expect(PARTICIPANT_SCORING_DEFINITIONS[id].direction).toMatch(/^(LOWER|HIGHER)_IS_BETTER$/);
    }
  });

  it('names a known scoring family, and a tournament format that admits at least one contest format', () => {
    expect(Object.values(ScoringFamily)).toContain(definition.scoringFamily);
    expect(getDefaultTournamentFormatForSport(sport)).toBe(definition.tournamentFormat);
    expect(getValidContestFormatsForTournamentFormat(definition.tournamentFormat).length).toBeGreaterThan(0);
  });

  it('gives a new event at least one round and at least one tier of at least one participant', () => {
    const { tierCount, tierSize } = definition.defaultTierLayout;

    for (const count of [definition.defaultRounds, tierCount, tierSize]) {
      expect(Number.isInteger(count) && count >= 1).toBe(true);
    }
  });

  it('has a name and every vocabulary word filled in, and an eliminated word that is either absent or filled in', () => {
    const { participant, event, sportLeague, round, eliminated, withdrawn, eventStart } = definition.vocabulary;
    for (const word of [
      definition.name,
      participant.one,
      participant.many,
      event.one,
      event.many,
      sportLeague.one,
      sportLeague.many,
      round.one,
      round.many,
      withdrawn,
      eventStart,
    ]) {
      expect(word.trim()).not.toBe('');
    }
    if (eliminated !== undefined) {
      expect(eliminated.trim()).not.toBe('');
    }
  });

  it('labels every round of an eight-round event, each one differently', () => {
    const labels = Array.from({ length: 8 }, (_, index) => definition.roundLabel(index + 1, 8));

    expect(labels.every((label) => label.trim() !== '')).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('sport registry', () => {
  it('has a definition for every sport in the enum', () => {
    expect(Object.keys(SPORT_DEFINITIONS).sort()).toEqual(Object.values(Sport).sort());
  });

  it('labels golf rounds by number and calls an eliminated golfer Cut', () => {
    const golf = getSportDefinition(Sport.GOLF);

    expect(golf.roundLabel(2, 4)).toBe('Round 2');
    expect(golf.vocabulary.eliminated).toBe('Cut');
    expect(golf.scoringFamily).toBe(ScoringFamily.STROKE_PLAY);
  });

  it('scores horse racing by finishing place, calls a withdrawn horse Scratched, and has no word for eliminated', () => {
    const horseRacing = getSportDefinition(Sport.HORSE_RACING);

    expect(horseRacing.scoringFamily).toBe(ScoringFamily.FINISH_POSITION);
    expect(horseRacing.scoringDefinitions).toEqual(['FINISH_POSITION_POINTS']);
    expect(horseRacing.vocabulary.withdrawn).toBe('Scratched');
    expect(horseRacing.vocabulary.eliminated).toBeUndefined();
    expect(horseRacing.vocabulary.participant).toEqual({ one: 'horse', many: 'horses' });
  });

  it('calls a horse racing event a race and its sport league a circuit, and a golf one a tournament on a tour', () => {
    const horseRacing = getSportDefinition(Sport.HORSE_RACING);
    const golf = getSportDefinition(Sport.GOLF);

    expect(horseRacing.name).toBe('Horse racing');
    expect(horseRacing.vocabulary.event).toEqual({ one: 'race', many: 'races' });
    expect(horseRacing.vocabulary.sportLeague).toEqual({ one: 'circuit', many: 'circuits' });
    expect(golf.name).toBe('Golf');
    expect(golf.vocabulary.event).toEqual({ one: 'tournament', many: 'tournaments' });
    expect(golf.vocabulary.sportLeague).toEqual({ one: 'tour', many: 'tours' });
  });

  it('gives a new horse race one round labelled Race, and three tiers so an eight-runner field fills each', () => {
    const horseRacing = getSportDefinition(Sport.HORSE_RACING);

    expect(horseRacing.defaultRounds).toBe(1);
    expect(horseRacing.roundLabel(1, 1)).toBe('Race');
    const { tierCount, tierSize } = horseRacing.defaultTierLayout;
    expect(tierCount).toBe(3);
    expect(tierSize * (tierCount - 1)).toBeLessThan(8);
  });

  it('scores auto racing by finishing place in races of a series, calls a driver a driver, and names no rider, top places or eliminated', () => {
    const autoRacing = getSportDefinition(Sport.AUTO_RACING);

    expect(autoRacing.name).toBe('Auto racing');
    expect(autoRacing.scoringFamily).toBe(ScoringFamily.FINISH_POSITION);
    expect(autoRacing.scoringDefinitions).toEqual(['FINISH_POSITION_POINTS']);
    expect(autoRacing.vocabulary).toEqual({
      participant: { one: 'driver', many: 'drivers' },
      event: { one: 'race', many: 'races' },
      sportLeague: { one: 'series', many: 'series' },
      round: { one: 'race', many: 'races' },
      withdrawn: 'Withdrawn',
      eventStart: 'green flag',
    });
  });

  it('gives a new auto race one round labelled Race, and five tiers of eight so a 40-car field fills each exactly', () => {
    const autoRacing = getSportDefinition(Sport.AUTO_RACING);

    expect(autoRacing.defaultRounds).toBe(1);
    expect(autoRacing.roundLabel(1, 1)).toBe('Race');
    expect(autoRacing.defaultTierLayout).toEqual({ tierCount: 5, tierSize: 8 });
    expect(autoRacing.selectionTypes).toEqual([SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW]);
  });

  it('scores cycling by final overall place in races of a tour, calls a rider a rider, and names no rider column, top places or eliminated', () => {
    const cycling = getSportDefinition(Sport.CYCLING);

    expect(cycling.name).toBe('Cycling');
    expect(cycling.scoringFamily).toBe(ScoringFamily.FINISH_POSITION);
    expect(cycling.scoringDefinitions).toEqual(['FINISH_POSITION_POINTS']);
    expect(cycling.vocabulary).toEqual({
      participant: { one: 'rider', many: 'riders' },
      event: { one: 'race', many: 'races' },
      sportLeague: { one: 'tour', many: 'tours' },
      round: { one: 'race', many: 'races' },
      withdrawn: 'Withdrawn',
      eventStart: 'start',
    });
  });

  it('gives a new cycling race one round labelled Race, not one per stage, and five tiers of ten with the last taking the rest', () => {
    const cycling = getSportDefinition(Sport.CYCLING);

    expect(cycling.defaultRounds).toBe(1);
    expect(cycling.roundLabel(1, 1)).toBe('Race');
    expect(cycling.defaultTierLayout).toEqual({ tierCount: 5, tierSize: 10 });
    expect(cycling.selectionTypes).toEqual([SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW]);
  });

  it('scores running by finishing place in races of a series, calls a runner a runner, and names no rider column, top places or eliminated', () => {
    const running = getSportDefinition(Sport.RUNNING);

    expect(running.name).toBe('Running');
    expect(running.participantType).toBe('INDIVIDUAL');
    expect(running.scoringFamily).toBe(ScoringFamily.FINISH_POSITION);
    expect(running.scoringDefinitions).toEqual(['FINISH_POSITION_POINTS']);
    expect(running.vocabulary).toEqual({
      participant: { one: 'runner', many: 'runners' },
      event: { one: 'race', many: 'races' },
      sportLeague: { one: 'series', many: 'series' },
      round: { one: 'race', many: 'races' },
      withdrawn: 'Withdrawn',
      eventStart: 'start',
    });
  });

  it('gives a new running race one round labelled Race, and four tiers of six with the last taking the rest of an elite field', () => {
    const running = getSportDefinition(Sport.RUNNING);

    expect(running.defaultRounds).toBe(1);
    expect(running.roundLabel(1, 1)).toBe('Race');
    expect(running.defaultTierLayout).toEqual({ tierCount: 4, tierSize: 6 });
    expect(running.selectionTypes).toEqual([SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW]);
  });

  it('gives a new golf event four rounds and six tiers of ten golfers', () => {
    const golf = getSportDefinition(Sport.GOLF);

    expect(golf.defaultRounds).toBe(4);
    expect(golf.defaultTierLayout).toEqual({ tierCount: 6, tierSize: 10 });
  });
});

describe('sportAllowsSelectionType', () => {
  it('refuses a selection type the sport definition does not list, and allows one it does', () => {
    const tieredOnly: SportDefinition = { ...getSportDefinition(Sport.GOLF), selectionTypes: [SelectionType.TIERED] };

    expect(sportAllowsSelectionType(tieredOnly, SelectionType.BUDGET_PICK)).toBe(false);
    expect(sportAllowsSelectionType(tieredOnly, SelectionType.TIERED)).toBe(true);
  });
});

describe('basketball', () => {
  const basketball = getSportDefinition(Sport.BASKETBALL);

  it('is a team sport played as a knockout bracket, scored head to head by knockout round points', () => {
    expect(basketball.name).toBe('Basketball');
    expect(basketball.participantType).toBe('TEAM');
    expect(basketball.scoringFamily).toBe(ScoringFamily.HEAD_TO_HEAD);
    expect(basketball.tournamentFormat).toBe(TournamentFormat.KNOCKOUT_BRACKET);
    expect(basketball.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
    expect(sportPlaysBracket(Sport.BASKETBALL)).toBe(true);
  });

  it('gives a new tournament six rounds and the four seed lines as four tiers of 16', () => {
    expect(basketball.defaultRounds).toBe(6);
    expect(basketball.defaultTierLayout).toEqual({ tierCount: 4, tierSize: 16 });
    expect(basketball.selectionTypes).toEqual([SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW]);
  });

  it('labels a six-round bracket First Round through National Championship', () => {
    expect([1, 2, 3, 4, 5, 6].map((roundNumber) => basketball.roundLabel(roundNumber, 6))).toEqual([
      'First Round', 'Second Round', 'Sweet 16', 'Elite Eight', 'Final Four', 'National Championship',
    ]);
  });

  it('names a shorter bracket\'s rounds back from its final, so a four-round bracket starts at the Sweet 16', () => {
    expect([1, 2, 3, 4].map((roundNumber) => basketball.roundLabel(roundNumber, 4))).toEqual([
      'Sweet 16', 'Elite Eight', 'Final Four', 'National Championship',
    ]);
  });

  it('calls a stored round past the event\'s round count Round N, never a name counted from the final', () => {
    expect(basketball.roundLabel(7, 6)).toBe('Round 7');
  });

  it('calls a participant a team and the moment entries close the opening tip-off', () => {
    expect(basketball.vocabulary.participant).toEqual({ one: 'team', many: 'teams' });
    expect(basketball.vocabulary.eventStart).toBe('opening tip-off');
    expect(basketball.vocabulary.eliminated).toBe('Eliminated');
  });
});

describe('American football', () => {
  const americanFootball = getSportDefinition(Sport.AMERICAN_FOOTBALL);

  it('is a team sport played as a knockout bracket, scored head to head by knockout round points', () => {
    expect(americanFootball.name).toBe('American football');
    expect(americanFootball.participantType).toBe('TEAM');
    expect(americanFootball.scoringFamily).toBe(ScoringFamily.HEAD_TO_HEAD);
    expect(americanFootball.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
    expect(sportPlaysBracket(Sport.AMERICAN_FOOTBALL)).toBe(true);
  });

  it('gives new playoffs four rounds and seven tiers of two, one for each pair of the 14 teams', () => {
    expect(americanFootball.defaultRounds).toBe(4);
    expect(americanFootball.defaultTierLayout).toEqual({ tierCount: 7, tierSize: 2 });
  });

  it('labels a four-round bracket Wild Card through Super Bowl, and a stored round past the count Round N', () => {
    expect([1, 2, 3, 4].map((roundNumber) => americanFootball.roundLabel(roundNumber, 4))).toEqual([
      'Wild Card', 'Divisional', 'Conference Championship', 'Super Bowl',
    ]);
    expect(americanFootball.roundLabel(5, 4)).toBe('Round 5');
  });

  it('calls the event the playoffs and the moment entries close the first kickoff', () => {
    expect(americanFootball.vocabulary.event).toEqual({ one: 'playoffs', many: 'playoffs' });
    expect(americanFootball.vocabulary.eventStart).toBe('first kickoff');
  });
});

describe('sportPlaysBracket', () => {
  it('is true only for a sport whose tournament format is a knockout bracket', () => {
    for (const definition of definitions) {
      expect(sportPlaysBracket(definition.sport)).toBe(definition.tournamentFormat === TournamentFormat.KNOCKOUT_BRACKET);
    }
  });
});

describe('round labels from a sport league\'s own round names', () => {
  const nba = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];

  it('names each round of an NBA bracket by the league\'s names, not March Madness\'s', () => {
    expect([1, 2, 3, 4].map((roundNumber) => eventRoundLabel(Sport.BASKETBALL, nba, roundNumber, 4))).toEqual(nba);
  });

  it('lines the league\'s names up with the final, so a shorter bracket keeps the last ones and a longer one takes the sport\'s for its first rounds', () => {
    expect([1, 2, 3].map((roundNumber) => eventRoundLabel(Sport.BASKETBALL, nba, roundNumber, 3))).toEqual(['Conference Semifinals', 'Conference Finals', 'NBA Finals']);
    expect([1, 2, 3, 4, 5].map((roundNumber) => eventRoundLabel(Sport.BASKETBALL, nba, roundNumber, 5))).toEqual(['First Round', 'First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals']);
  });

  it('uses the sport\'s names for a league that names none, and for a stored round past the count', () => {
    expect([1, 2, 3, 4, 5, 6].map((roundNumber) => eventRoundLabel(Sport.BASKETBALL, [], roundNumber, 6))).toEqual([
      'First Round', 'Second Round', 'Sweet 16', 'Elite Eight', 'Final Four', 'National Championship',
    ]);
    expect(eventRoundLabel(Sport.BASKETBALL, nba, 5, 4)).toBe(getSportDefinition(Sport.BASKETBALL).roundLabel(5, 4));
  });
});
