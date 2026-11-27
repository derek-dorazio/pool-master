import {
  getSportDefinition,
  isPredictionSelectionType,
  PARTICIPANT_SCORING_DEFINITIONS,
  SelectionType,
  Sport,
  SPORT_DEFINITIONS,
  sportAllowsSelectionType,
  type SportDefinition,
  sportVocabulary,
} from '@poolmaster/shared/domain';
import { enUS } from '@poolmaster/shared/display-strings';
import { getSelectionEngine } from '../../../packages/core-api/src/modules/selections/selection-engines/registry';
import { getPredictionEngine } from '../../../packages/core-api/src/modules/selections/prediction-engines/registry';

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
      // Squares (#711) has no engine: its own service claims boxes and draws the digits.
      if (selectionType === SelectionType.SQUARES) continue;
      const engine = isPredictionSelectionType(selectionType)
        ? getPredictionEngine(selectionType)
        : getSelectionEngine(selectionType);
      expect(engine.selectionType).toBe(selectionType);
    }
  });

  it('ranks only by scoring definitions that are declared with a direction', () => {
    for (const id of definition.scoringDefinitions) {
      expect(PARTICIPANT_SCORING_DEFINITIONS[id].direction).toMatch(/^(LOWER|HIGHER)_IS_BETTER$/);
    }
  });

  it('says what its pick\'em pools can be exactly when it offers pick\'em (#792)', () => {
    expect(definition.pickEm !== undefined).toBe(definition.selectionTypes.includes(SelectionType.PICK_EM));
  });

  it('has its own display string for a game that ends level exactly when it offers a prediction contest, so results and picks call a tie by its word (#792)', () => {
    expect('tie' in enUS.sport[definition.sport]).toBe(definition.selectionTypes.some(isPredictionSelectionType));
  });

  it('has a name and every sport word filled in, its own or the generic one', () => {
    const { participant, event, sportLeague, round, eliminated, withdrawn, eventStart } = sportVocabulary(definition);
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
      eliminated,
    ]) {
      expect(word.trim()).not.toBe('');
    }
  });

});

describe('sport registry', () => {
  it('has a definition for every sport in the enum', () => {
    expect(Object.keys(SPORT_DEFINITIONS).sort()).toEqual(Object.values(Sport).sort());
  });

  it('scores horse racing by finishing place, calls a withdrawn horse Scratched, and reads the generic Eliminated, having no word of its own', () => {
    const horseRacing = getSportDefinition(Sport.HORSE_RACING);
    expect(horseRacing.scoringDefinitions).toEqual(['FINISH_POSITION_POINTS']);
    expect(sportVocabulary(horseRacing).withdrawn).toBe('Scratched');
    expect(sportVocabulary(horseRacing).eliminated).toBe('Eliminated');
    expect(sportVocabulary(horseRacing).participant).toEqual({ one: 'horse', many: 'horses' });
  });

  it('calls a horse racing event a race and its sport league a circuit, and a golf one a tournament on a tour', () => {
    const horseRacing = getSportDefinition(Sport.HORSE_RACING);
    const golf = getSportDefinition(Sport.GOLF);

    expect(horseRacing.name).toBe('Horse racing');
    expect(sportVocabulary(horseRacing).event).toEqual({ one: 'race', many: 'races' });
    expect(sportVocabulary(horseRacing).sportLeague).toEqual({ one: 'circuit', many: 'circuits' });
    expect(golf.name).toBe('Golf');
    expect(sportVocabulary(golf).event).toEqual({ one: 'tournament', many: 'tournaments' });
    expect(sportVocabulary(golf).sportLeague).toEqual({ one: 'tour', many: 'tours' });
  });


  it('scores auto racing by finishing place in races of a series, calls a driver a driver, and names no rider or top places, and reads the generic Eliminated', () => {
    const autoRacing = getSportDefinition(Sport.AUTO_RACING);

    expect(autoRacing.name).toBe('Auto racing');
    expect(autoRacing.scoringDefinitions).toEqual(['FINISH_POSITION_POINTS']);
    expect(sportVocabulary(autoRacing)).toMatchObject({
      participant: { one: 'driver', many: 'drivers' },
      event: { one: 'race', many: 'races' },
      sportLeague: { one: 'series', many: 'series' },
      round: { one: 'race', many: 'races' },
      withdrawn: 'Withdrawn',
      eventStart: 'green flag',
      eliminated: 'Eliminated',
    });
    expect([sportVocabulary(autoRacing).rider, sportVocabulary(autoRacing).topPlaces]).toEqual([undefined, undefined]);
  });

  it('gives a new auto race one round, and five tiers of eight so a 40-car field fills each exactly', () => {
    const autoRacing = getSportDefinition(Sport.AUTO_RACING);

    expect(autoRacing.selectionTypes).toEqual([SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW]);
  });

  it('scores cycling by final overall place in races of a tour, calls a rider a rider, and names no rider column or top places, and reads the generic Eliminated', () => {
    const cycling = getSportDefinition(Sport.CYCLING);

    expect(cycling.name).toBe('Cycling');
    expect(cycling.scoringDefinitions).toEqual(['FINISH_POSITION_POINTS']);
    expect(sportVocabulary(cycling)).toMatchObject({
      participant: { one: 'rider', many: 'riders' },
      event: { one: 'race', many: 'races' },
      sportLeague: { one: 'tour', many: 'tours' },
      round: { one: 'race', many: 'races' },
      withdrawn: 'Withdrawn',
      eventStart: 'start',
      eliminated: 'Eliminated',
    });
    expect([sportVocabulary(cycling).rider, sportVocabulary(cycling).topPlaces]).toEqual([undefined, undefined]);
  });

  it('gives a new cycling race one round, not one per stage, and five tiers of ten with the last taking the rest', () => {
    const cycling = getSportDefinition(Sport.CYCLING);

    expect(cycling.selectionTypes).toEqual([SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW]);
  });

  it('scores running by finishing place in races of a series, calls a runner a runner, and names no rider column or top places, and reads the generic Eliminated', () => {
    const running = getSportDefinition(Sport.RUNNING);

    expect(running.name).toBe('Running');
    expect(running.scoringDefinitions).toEqual(['FINISH_POSITION_POINTS']);
    expect(sportVocabulary(running)).toMatchObject({
      participant: { one: 'runner', many: 'runners' },
      event: { one: 'race', many: 'races' },
      sportLeague: { one: 'series', many: 'series' },
      round: { one: 'race', many: 'races' },
      withdrawn: 'Withdrawn',
      eventStart: 'start',
      eliminated: 'Eliminated',
    });
    expect([sportVocabulary(running).rider, sportVocabulary(running).topPlaces]).toEqual([undefined, undefined]);
  });

  it('gives a new running race one round, and four tiers of six with the last taking the rest of an elite field', () => {
    const running = getSportDefinition(Sport.RUNNING);

    expect(running.selectionTypes).toEqual([SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW]);
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

  it('is a team sport played as a knockout bracket, scored by knockout round points', () => {
    expect(basketball.name).toBe('Basketball');
    expect(basketball.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
  });


  it('offers the three roster selection types, pick\'em, bracket, survivor and squares', () => {
    expect(basketball.selectionTypes).toEqual([
      SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.PICK_EM, SelectionType.BRACKET,
      SelectionType.SURVIVOR, SelectionType.SQUARES,
    ]);
  });

  it('calls a participant a team and the moment entries close the opening tip-off', () => {
    expect(sportVocabulary(basketball).participant).toEqual({ one: 'team', many: 'teams' });
    expect(sportVocabulary(basketball).eventStart).toBe('opening tip-off');
    expect(sportVocabulary(basketball).eliminated).toBe('Eliminated');
  });
});

describe('American football', () => {
  const americanFootball = getSportDefinition(Sport.FOOTBALL);

  it('is a team sport played as a knockout bracket, scored by knockout round points', () => {
    expect(americanFootball.name).toBe('Football');
    expect(americanFootball.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
  });


  it('offers the three roster selection types, pick\'em, bracket, survivor and squares', () => {
    expect(americanFootball.selectionTypes).toEqual([
      SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.PICK_EM, SelectionType.BRACKET,
      SelectionType.SURVIVOR, SelectionType.SQUARES,
    ]);
  });

  it('calls the event the playoffs and the moment entries close the first kickoff', () => {
    expect(sportVocabulary(americanFootball).event).toEqual({ one: 'playoffs', many: 'playoffs' });
    expect(sportVocabulary(americanFootball).eventStart).toBe('first kickoff');
  });

  it('offers pick\'em pools against the spread but no tie pick, and calls a game that ends level a Tie (#792)', () => {
    expect(americanFootball.pickEm).toEqual({ tiePicks: false, againstTheSpread: true });
    expect(sportVocabulary(americanFootball).tie).toBe('Tie');
  });
});

describe('hockey', () => {
  const hockey = getSportDefinition(Sport.HOCKEY);

  it('is a team sport played as a knockout bracket, scored by knockout round points', () => {
    expect(hockey.name).toBe('Hockey');
    expect(hockey.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
  });


  it('offers the three roster selection types, bracket, survivor and squares, and no pick\'em, since it has no weeks of games', () => {
    expect(hockey.selectionTypes).toEqual([
      SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.BRACKET, SelectionType.SURVIVOR, SelectionType.SQUARES,
    ]);
  });

  it('calls the event the playoffs, a game a game, and the moment entries close the opening puck drop', () => {
    expect(sportVocabulary(hockey).event).toEqual({ one: 'playoffs', many: 'playoffs' });
    expect(sportVocabulary(hockey).match).toEqual({ one: 'game', many: 'games' });
    expect(sportVocabulary(hockey).eventStart).toBe('opening puck drop');
  });
});

describe('baseball', () => {
  const baseball = getSportDefinition(Sport.BASEBALL);

  it('is a team sport played as a knockout bracket, scored by knockout round points', () => {
    expect(baseball.name).toBe('Baseball');
    expect(baseball.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
  });


  it('offers the three roster selection types, bracket and survivor, and no squares or pick\'em, since every round is a series', () => {
    expect(baseball.selectionTypes).toEqual([SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.BRACKET, SelectionType.SURVIVOR]);
  });

  it('calls the event the postseason, a match a series, and the moment entries close the first pitch', () => {
    expect(sportVocabulary(baseball).event).toEqual({ one: 'postseason', many: 'postseasons' });
    expect(sportVocabulary(baseball).match).toEqual({ one: 'series', many: 'series' });
    expect(sportVocabulary(baseball).eventStart).toBe('first pitch');
  });
});

describe('soccer', () => {
  const soccer = getSportDefinition(Sport.SOCCER);

  it('is a team sport played as a knockout bracket, scored by knockout round points', () => {
    expect(soccer.name).toBe('Soccer');
    expect(soccer.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
  });

  it('labels a shoot-out pens, and calls overtime extra time', () => {
    expect(sportVocabulary(soccer).shootout).toBe('pens');
    expect(sportVocabulary(soccer).overtime).toBe('extra time');
  });


  it('offers the three roster selection types, pick\'em, bracket, survivor and squares, its pick\'em taking draw picks and no spread', () => {
    expect(soccer.selectionTypes).toEqual([
      SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.PICK_EM, SelectionType.BRACKET, SelectionType.SURVIVOR, SelectionType.SQUARES,
    ]);
    expect(soccer.pickEm).toEqual({ tiePicks: true, againstTheSpread: false });
    expect(sportVocabulary(soccer).tie).toBe('Draw');
  });

  it('calls the event a tournament, its sport league a competition, and the moment entries close the first kickoff', () => {
    expect(sportVocabulary(soccer).event).toEqual({ one: 'tournament', many: 'tournaments' });
    expect(sportVocabulary(soccer).sportLeague).toEqual({ one: 'competition', many: 'competitions' });
    expect(sportVocabulary(soccer).match).toEqual({ one: 'match', many: 'matches' });
    expect(sportVocabulary(soccer).eventStart).toBe('first kickoff');
  });
});

describe('tennis', () => {
  const tennis = getSportDefinition(Sport.TENNIS);

  it('is an individual sport played as a knockout draw, scored by knockout round points, with no shoot-out', () => {
    expect(tennis.name).toBe('Tennis');
    expect(tennis.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
    expect(sportVocabulary(tennis).shootout).toBeUndefined();
  });


  it('offers the three roster selection types, bracket and survivor, and no pick\'em or squares', () => {
    expect(tennis.selectionTypes).toEqual([
      SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.BRACKET, SelectionType.SURVIVOR,
    ]);
    expect(tennis.pickEm).toBeUndefined();
  });

  it('calls a competitor a player, the event a draw, its sport league a tour, a knocked-out player Out, and a draw place filled later a qualifier place', () => {
    expect(sportVocabulary(tennis).participant).toEqual({ one: 'player', many: 'players' });
    expect(sportVocabulary(tennis).event).toEqual({ one: 'draw', many: 'draws' });
    expect(sportVocabulary(tennis).sportLeague).toEqual({ one: 'tour', many: 'tours' });
    expect(sportVocabulary(tennis).match).toEqual({ one: 'match', many: 'matches' });
    expect(sportVocabulary(tennis).eliminated).toBe('Out');
    expect(sportVocabulary(tennis).eventStart).toBe('first match');
  });
});
