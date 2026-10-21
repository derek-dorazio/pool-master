import { PredictedResult } from './enums';

/**
 * What a game pick says happens (#792): a team wins, named by its field row, or the game ends
 * level, which names no team.
 */
export type PredictedChoice =
  | { predictedResult: typeof PredictedResult.TEAM; sportEventParticipantId: string }
  | { predictedResult: typeof PredictedResult.TIE; sportEventParticipantId: null };

/** A pick that names a team: every bracket and survivor pick, and a pick'em pick that is not a tie. */
export type TeamChoice = Extract<PredictedChoice, { predictedResult: typeof PredictedResult.TEAM }>;

/** Whether the pick names a team rather than a tie. */
export function isTeamChoice<Choice extends PredictedChoice>(choice: Choice): choice is Choice & TeamChoice {
  return choice.predictedResult === PredictedResult.TEAM;
}
