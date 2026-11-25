import { ParticipantType, ScoringFamily, Sport, getSportDefinition, type SelectionType } from '@poolmaster/shared/domain';

/**
 * Who competes in a sport's leagues and how they are scored, as the leagues are seeded (#2001).
 * Test data only: the app reads both from each sport league, never from the sport. A fixture
 * built for a sport takes its league's play from here unless the test sets it.
 */
const SPORT_PLAY: Readonly<Record<Sport, { participantType: ParticipantType; scoringFamily: ScoringFamily }>> = {
  [Sport.GOLF]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.STROKE_PLAY },
  [Sport.HORSE_RACING]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.FINISH_POSITION },
  [Sport.AUTO_RACING]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.FINISH_POSITION },
  [Sport.CYCLING]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.FINISH_POSITION },
  [Sport.RUNNING]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.FINISH_POSITION },
  [Sport.TENNIS]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.BASKETBALL]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.FOOTBALL]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.HOCKEY]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.BASEBALL]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.SOCCER]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
};

/** A sport's leagues' participant type and scoring family, for a test fixture. */
export function sportPlay(sport: Sport): { participantType: ParticipantType; scoringFamily: ScoringFamily } {
  return SPORT_PLAY[sport];
}

/** A sport league's sport name and formats as the API sends them (#2107), for a test fixture. */
export function sportFacts(sport: Sport): { sportName: string; selectionTypes: SelectionType[] } {
  const definition = getSportDefinition(sport);
  return { sportName: definition.name, selectionTypes: [...definition.selectionTypes] };
}
