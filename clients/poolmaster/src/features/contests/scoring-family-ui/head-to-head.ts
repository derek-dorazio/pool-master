/**
 * Head to head's leaderboard (knockout brackets, #699): after the total, a Wins column, an Upset
 * bonus column when any pick earned one, and a Status column saying whether the team is still in
 * the bracket. A pick's total is its knockout round points, rendered through the contest's
 * participant scoring definition (`PARTICIPANT_SCORING_DEFINITIONS`). Until the bracket has a
 * result no team has points.
 */

import {
  PARTICIPANT_SCORING_DEFINITIONS,
  ParticipantStandingStatus,
  type SportDefinition,
} from '@poolmaster/shared/domain';
import type { ScoredContestEntryPickDto, SportEventParticipantDto } from '@/lib/api';
import type { LeaderboardDetailColumn, ScoringFamilyUi } from './types';

/**
 * The Status cell: the champion, the sport's word for a team out of the bracket ("Eliminated") or
 * withdrawn, "Alive" for a team that has won and not lost, or null (a dash) before its first result.
 */
export function formatKnockoutStatus(
  pick: ScoredContestEntryPickDto,
  participant: SportEventParticipantDto,
  sport: SportDefinition,
): string | null {
  if (!participant.isActive) {
    return sport.vocabulary.withdrawn;
  }
  if (participant.standing?.status === ParticipantStandingStatus.COMPLETE) {
    return 'Champion';
  }
  const knockout = pick.knockout;
  if (!knockout) {
    return null;
  }
  if (!knockout.isAlive) {
    return sport.vocabulary.eliminated ?? 'Out';
  }
  return knockout.wins > 0 ? 'Alive' : null;
}

export const headToHeadUi: ScoringFamilyUi = {
  // The tiebreaker (one total-points prediction) arrives with bracket pools.
  entryTiebreaker: null,
  leaderboard(response, sport) {
    const definition = PARTICIPANT_SCORING_DEFINITIONS[response.scoringDefinitionId];
    const showsBonus = response.entries.some((entry) => entry.picks.some((pick) => (pick.knockout?.upsetBonusPoints ?? 0) > 0));
    const detailColumns: LeaderboardDetailColumn[] = [
      { key: 'wins', label: 'Wins', testId: 'contest-leaderboard-wins-header', width: 'minmax(48px,0.3fr)' },
      ...(showsBonus
        ? [{ key: 'upset-bonus', label: 'Upset bonus', testId: 'contest-leaderboard-upset-bonus-header', width: 'minmax(64px,0.4fr)' }]
        : []),
      { key: 'status', label: 'Status', testId: 'contest-leaderboard-status-header', width: 'minmax(80px,0.5fr)' },
    ];
    return {
      detailColumns,
      footnote: null,
      pickDetail(entryId, pick, participant) {
        const knockout = pick.knockout;
        const points = knockout?.points ?? null;
        return {
          total: points === null ? null : definition.format(points),
          detailCells: [
            {
              key: 'wins',
              testId: `contest-leaderboard-pick-wins-${entryId}-${pick.pickId}`,
              text: knockout && points !== null ? String(knockout.wins) : null,
            },
            ...(showsBonus
              ? [{
                key: 'upset-bonus',
                testId: `contest-leaderboard-pick-upset-bonus-${entryId}-${pick.pickId}`,
                text: knockout && points !== null ? String(knockout.upsetBonusPoints) : null,
              }]
              : []),
            {
              key: 'status',
              testId: `contest-leaderboard-pick-status-${entryId}-${pick.pickId}`,
              text: formatKnockoutStatus(pick, participant, sport),
            },
          ],
        };
      },
    };
  },
};
