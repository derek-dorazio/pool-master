import {
  contestFormatForSelectionType,
  eventRoundLabel,
  getDefaultTournamentFormatForSport,
  getSportDefinition,
  getValidContestFormatsForTournamentFormat,
  isContestFormatValidForTournamentFormat,
  isPredictionSelectionType,
  MatchPeriodLayout,
  PARTICIPANT_SCORING_DEFINITIONS,
  SelectionType,
  Sport,
  SPORT_DEFINITIONS,
  sportAllowsSelectionType,
  type SportDefinition,
  sportPlaysMatches,
  sportVocabulary,
  TournamentFormat,
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

  it('allows only selection types whose contest format its tournament format admits', () => {
    for (const selectionType of definition.selectionTypes) {
      expect(isContestFormatValidForTournamentFormat(
        definition.tournamentFormat,
        contestFormatForSelectionType(selectionType),
      )).toBe(true);
    }
  });

  it('ranks only by scoring definitions that are declared with a direction', () => {
    for (const id of definition.scoringDefinitions) {
      expect(PARTICIPANT_SCORING_DEFINITIONS[id].direction).toMatch(/^(LOWER|HIGHER)_IS_BETTER$/);
    }
  });

  it('names a tournament format that admits at least one contest format', () => {
    expect(getDefaultTournamentFormatForSport(sport)).toBe(definition.tournamentFormat);
    expect(getValidContestFormatsForTournamentFormat(definition.tournamentFormat).length).toBeGreaterThan(0);
  });

  it('gives a new event at least one round', () => {
    expect(Number.isInteger(definition.defaultRounds) && definition.defaultRounds >= 1).toBe(true);
  });

  it('says what its pick\'em pools can be exactly when it offers pick\'em (#792)', () => {
    expect(definition.pickEm !== undefined).toBe(definition.selectionTypes.includes(SelectionType.PICK_EM));
  });

  it('has its own display string for a game that ends level exactly when it plays matches, so results and picks call a tie by its word (#792)', () => {
    expect('tie' in enUS.sport[definition.sport]).toBe(sportPlaysMatches(definition.sport));
  });

  it('says a shoot-out word exactly when it settles level knockout matches by a shoot-out', () => {
    expect(sportVocabulary(definition).shootout !== undefined).toBe(definition.shootout);
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
    expect(sportVocabulary(golf).eliminated).toBe('Cut');
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

  it('gives a new horse race one round labelled Race', () => {
    const horseRacing = getSportDefinition(Sport.HORSE_RACING);

    expect(horseRacing.defaultRounds).toBe(1);
    expect(horseRacing.roundLabel(1, 1)).toBe('Race');
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

  it('gives a new auto race one round labelled Race, and five tiers of eight so a 40-car field fills each exactly', () => {
    const autoRacing = getSportDefinition(Sport.AUTO_RACING);

    expect(autoRacing.defaultRounds).toBe(1);
    expect(autoRacing.roundLabel(1, 1)).toBe('Race');
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

  it('gives a new cycling race one round labelled Race, not one per stage, and five tiers of ten with the last taking the rest', () => {
    const cycling = getSportDefinition(Sport.CYCLING);

    expect(cycling.defaultRounds).toBe(1);
    expect(cycling.roundLabel(1, 1)).toBe('Race');
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

  it('gives a new running race one round labelled Race, and four tiers of six with the last taking the rest of an elite field', () => {
    const running = getSportDefinition(Sport.RUNNING);

    expect(running.defaultRounds).toBe(1);
    expect(running.roundLabel(1, 1)).toBe('Race');
    expect(running.selectionTypes).toEqual([SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW]);
  });

  it('gives a new golf event four rounds', () => {
    const golf = getSportDefinition(Sport.GOLF);

    expect(golf.defaultRounds).toBe(4);
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
    expect(basketball.tournamentFormat).toBe(TournamentFormat.MATCHES);
    expect(basketball.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
    expect(sportPlaysMatches(Sport.BASKETBALL)).toBe(true);
  });

  it('gives a new tournament six rounds', () => {
    expect(basketball.defaultRounds).toBe(6);
  });

  it('offers the three roster selection types, pick\'em, bracket, survivor and squares', () => {
    expect(basketball.selectionTypes).toEqual([
      SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.PICK_EM, SelectionType.BRACKET,
      SelectionType.SURVIVOR, SelectionType.SQUARES,
    ]);
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
    expect(sportVocabulary(basketball).participant).toEqual({ one: 'team', many: 'teams' });
    expect(sportVocabulary(basketball).eventStart).toBe('opening tip-off');
    expect(sportVocabulary(basketball).eliminated).toBe('Eliminated');
  });
});

describe('American football', () => {
  const americanFootball = getSportDefinition(Sport.AMERICAN_FOOTBALL);

  it('is a team sport played as a knockout bracket, scored by knockout round points', () => {
    expect(americanFootball.name).toBe('American football');
    expect(americanFootball.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
    expect(sportPlaysMatches(Sport.AMERICAN_FOOTBALL)).toBe(true);
  });

  it('gives new playoffs four rounds', () => {
    expect(americanFootball.defaultRounds).toBe(4);
  });

  it('labels a four-round bracket Wild Card through Super Bowl, and a stored round past the count Round N', () => {
    expect([1, 2, 3, 4].map((roundNumber) => americanFootball.roundLabel(roundNumber, 4))).toEqual([
      'Wild Card', 'Divisional', 'Conference Championship', 'Super Bowl',
    ]);
    expect(americanFootball.roundLabel(5, 4)).toBe('Round 5');
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

  it('is a team sport played as a knockout bracket, scored by knockout round points, in three periods a game', () => {
    expect(hockey.name).toBe('Hockey');
    expect(hockey.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
    expect(hockey.matchPeriodLayout).toBe(MatchPeriodLayout.THREE_PERIODS);
    expect(sportPlaysMatches(Sport.HOCKEY)).toBe(true);
  });

  it('gives new playoffs four rounds, for a 16-team bracket', () => {
    expect(hockey.defaultRounds).toBe(4);
  });

  it('labels a four-round bracket Regional Semifinals through National Championship, and a stored round past the count Round N', () => {
    expect([1, 2, 3, 4].map((roundNumber) => hockey.roundLabel(roundNumber, 4))).toEqual([
      'Regional Semifinals', 'Regional Finals', 'Frozen Four', 'National Championship',
    ]);
    expect(hockey.roundLabel(5, 4)).toBe('Round 5');
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

  it('is a team sport played as a knockout bracket, scored by knockout round points, keeping no score by period', () => {
    expect(baseball.name).toBe('Baseball');
    expect(baseball.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
    expect(baseball.matchPeriodLayout).toBeUndefined();
    expect(sportPlaysMatches(Sport.BASEBALL)).toBe(true);
  });

  it('gives a new postseason four rounds, for a 12-team bracket', () => {
    expect(baseball.defaultRounds).toBe(4);
  });

  it('labels a four-round postseason Wild Card Series through World Series, and a stored round past the count Round N', () => {
    expect([1, 2, 3, 4].map((roundNumber) => baseball.roundLabel(roundNumber, 4))).toEqual([
      'Wild Card Series', 'Division Series', 'League Championship Series', 'World Series',
    ]);
    expect(baseball.roundLabel(5, 4)).toBe('Round 5');
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

  it('is a team sport played as a knockout bracket, scored by knockout round points, in two halves a match', () => {
    expect(soccer.name).toBe('Soccer');
    expect(soccer.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
    expect(soccer.matchPeriodLayout).toBe(MatchPeriodLayout.HALVES);
    expect(sportPlaysMatches(Sport.SOCCER)).toBe(true);
  });

  it('settles a knockout match level after extra time by a shoot-out, labelled pens, and calls overtime extra time', () => {
    expect(soccer.shootout).toBe(true);
    expect(sportVocabulary(soccer).shootout).toBe('pens');
    expect(sportVocabulary(soccer).overtime).toBe('extra time');
  });

  it('gives a new tournament four rounds, for a 16-team knockout stage', () => {
    expect(soccer.defaultRounds).toBe(4);
  });

  it('labels a four-round knockout Round of 16 through Final, a five-round one from the Round of 32, and a stored round past the count Round N', () => {
    expect([1, 2, 3, 4].map((roundNumber) => soccer.roundLabel(roundNumber, 4))).toEqual(['Round of 16', 'Quarter-finals', 'Semi-finals', 'Final']);
    expect(soccer.roundLabel(1, 5)).toBe('Round of 32');
    expect(soccer.roundLabel(1, 3)).toBe('Quarter-finals');
    expect(soccer.roundLabel(5, 4)).toBe('Round 5');
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

  it('is an individual sport played as a knockout draw, scored by knockout round points, with no periods and no shoot-out', () => {
    expect(tennis.name).toBe('Tennis');
    expect(tennis.scoringDefinitions).toEqual(['KNOCKOUT_ROUND_POINTS']);
    expect(tennis.matchPeriodLayout).toBeUndefined();
    expect(tennis.shootout).toBe(false);
    expect(sportPlaysMatches(Sport.TENNIS)).toBe(true);
  });

  it('gives a new draw seven rounds', () => {
    expect(tennis.defaultRounds).toBe(7);
  });

  it('labels a Slam\'s seven rounds First round through Final, a six-round draw with no Fourth round, and a stored round past the count Round N', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((roundNumber) => tennis.roundLabel(roundNumber, 7))).toEqual([
      'First round', 'Second round', 'Third round', 'Fourth round', 'Quarterfinals', 'Semifinals', 'Final',
    ]);
    expect([1, 2, 3, 4, 5, 6].map((roundNumber) => tennis.roundLabel(roundNumber, 6))).toEqual([
      'First round', 'Second round', 'Third round', 'Quarterfinals', 'Semifinals', 'Final',
    ]);
    expect(tennis.roundLabel(8, 7)).toBe('Round 8');
    expect(tennis.roundLabel(4, 3)).toBe('Round 4');
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
    expect(sportVocabulary(tennis).playInPlace).toBe('qualifier');
  });
});

describe('sportPlaysMatches', () => {
  it('is true only for a sport whose tournament format is a knockout bracket', () => {
    for (const definition of definitions) {
      expect(sportPlaysMatches(definition.sport)).toBe(definition.tournamentFormat === TournamentFormat.MATCHES);
    }
  });
});

describe('round labels from a sport league\'s own round names', () => {
  const nba = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];

  it('names each round of an NBA bracket by the league\'s names, not March Madness\'s', () => {
    expect([1, 2, 3, 4].map((roundNumber) => eventRoundLabel({ sport: Sport.BASKETBALL }, nba, roundNumber, 4))).toEqual(nba);
  });

  it('lines the league\'s names up with the final, so a shorter bracket keeps the last ones and a longer one takes the sport\'s for its first rounds', () => {
    expect([1, 2, 3].map((roundNumber) => eventRoundLabel({ sport: Sport.BASKETBALL }, nba, roundNumber, 3))).toEqual(['Conference Semifinals', 'Conference Finals', 'NBA Finals']);
    expect([1, 2, 3, 4, 5].map((roundNumber) => eventRoundLabel({ sport: Sport.BASKETBALL }, nba, roundNumber, 5))).toEqual(['First Round', 'First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals']);
  });

  it('uses the sport\'s names for a league that names none, and for a stored round past the count', () => {
    expect([1, 2, 3, 4, 5, 6].map((roundNumber) => eventRoundLabel({ sport: Sport.BASKETBALL }, [], roundNumber, 6))).toEqual([
      'First Round', 'Second Round', 'Sweet 16', 'Elite Eight', 'Final Four', 'National Championship',
    ]);
    expect(eventRoundLabel({ sport: Sport.BASKETBALL }, nba, 5, 4)).toBe(getSportDefinition(Sport.BASKETBALL).roundLabel(5, 4));
  });
});
