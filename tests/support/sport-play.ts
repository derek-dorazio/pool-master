import { ParticipantType, ScoringFamily, Sport, type SportLeaguePlay } from '@poolmaster/shared/domain';

/**
 * Who competes in a sport's leagues and how they are scored, as the migrations seed them (#2001).
 * Test data only: the app reads both from each sport league, never from the sport. A test league
 * or event built for a sport takes its play from here unless the test is about another.
 */
const SPORT_PLAY: Readonly<Record<Sport, SportLeaguePlay>> = {
  [Sport.GOLF]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.STROKE_PLAY },
  [Sport.HORSE_RACING]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.FINISH_POSITION },
  [Sport.AUTO_RACING]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.FINISH_POSITION },
  [Sport.CYCLING]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.FINISH_POSITION },
  [Sport.RUNNING]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.FINISH_POSITION },
  [Sport.TENNIS]: { participantType: ParticipantType.INDIVIDUAL, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.BASKETBALL]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.AMERICAN_FOOTBALL]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.HOCKEY]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.BASEBALL]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
  [Sport.SOCCER]: { participantType: ParticipantType.TEAM, scoringFamily: ScoringFamily.HEAD_TO_HEAD },
};

/** A sport's leagues' participant type and scoring family, for a test row or event. */
export function sportPlay(sport: Sport): SportLeaguePlay {
  return SPORT_PLAY[sport];
}
