import {
  type ContestScoringSettings,
  type RoundName,
  type SportNoun,
  formatContestRules,
  formatEntriesPerTeamSentence,
} from '@poolmaster/shared/domain';
import type { ContestConfigurationRequest } from '@poolmaster/shared/dto';
import { SCORING_SETTINGS_UI } from './contest-scoring-settings';

/**
 * The rules sentence a contest's row reads to members, as Create and Edit contest preview it: its
 * rules, how its picks score when the rules sentence does not say, and its entries per team.
 * Edit contest does not change the scoring, so it passes none and the sentence leaves it out.
 */
export function membersWillSeeRules(
  configuration: ContestConfigurationRequest,
  scoring: ContestScoringSettings | null,
  { participant, roundName, salaryCap, tierCount }: {
    participant: SportNoun;
    roundName?: RoundName;
    salaryCap: number | null;
    tierCount: number;
  },
) {
  return [
    formatContestRules(configuration, tierCount, participant, salaryCap, roundName),
    scoring ? SCORING_SETTINGS_UI[scoring.participantScoringDefinitionId].describe(scoring) : null,
    `${formatEntriesPerTeamSentence(configuration.maxEntriesPerSquad)}.`,
  ].filter((sentence) => sentence !== null).join(' ');
}
