import {
  contestTemplateEventTypeOf,
  eventPlaysMatches,
  eventSportDefinition,
  getSportDefinition,
  ParticipantType,
  ScoringFamily,
  Sport,
  sportLeagueDefinitionOf,
} from '@poolmaster/shared/domain';
import { sportPlay } from '../../support/sport-play';

// A sport league's definition (#934, #2001): its sport's, with the league's own participant type
// and scoring family, which the sport registry no longer carries.

describe('sportLeagueDefinitionOf', () => {
  it('gives a sport league its sport\'s definition with the league\'s participant type and scoring family', () => {
    const definition = sportLeagueDefinitionOf(Sport.BASEBALL, { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD });

    expect(definition).toEqual({ ...getSportDefinition(Sport.BASEBALL), participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD });
  });

  it('takes the league\'s play as it is, so a team golf league keeps stroke-play scoring definitions', () => {
    const definition = sportLeagueDefinitionOf(Sport.GOLF, { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.STROKE_PLAY });

    expect([definition.participantType, definition.scoringFamily, definition.scoringDefinitions])
      .toEqual([ParticipantType.TEAM, ScoringFamily.STROKE_PLAY, ['GOLF_RELATIVE_TO_PAR_TOTAL']]);
  });

  it('copies only the two play fields from a league row, never anything else on it', () => {
    const league = { ...sportPlay(Sport.GOLF), name: 'PGA TOUR', sport: Sport.BASEBALL };

    expect(sportLeagueDefinitionOf(Sport.GOLF, league)).toEqual({ ...getSportDefinition(Sport.GOLF), ...sportPlay(Sport.GOLF) });
  });
});

describe('An event read through its sport league', () => {
  it('reads its sport\'s definition with the participant type and scoring family the event carries', () => {
    const definition = eventSportDefinition({ sport: Sport.GOLF, participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.STROKE_PLAY });

    expect([definition.sport, definition.participantType, definition.scoringFamily]).toEqual([Sport.GOLF, ParticipantType.TEAM, ScoringFamily.STROKE_PLAY]);
  });

  it('plays matches when its sport does, and is the kind of match event its sport\'s format names', () => {
    expect([
      eventPlaysMatches({ sport: Sport.BASEBALL, ...sportPlay(Sport.BASEBALL) }),
      eventPlaysMatches({ sport: Sport.GOLF, ...sportPlay(Sport.GOLF) }),
    ]).toEqual([true, false]);
    expect(contestTemplateEventTypeOf({ sport: Sport.BASEBALL, ...sportPlay(Sport.BASEBALL), rounds: 4 })).toBe('KNOCKOUT');
  });
});
