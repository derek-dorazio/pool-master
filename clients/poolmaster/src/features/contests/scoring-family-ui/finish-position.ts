/**
 * Finish position's leaderboard (racing, #622): one Finish column after the total, showing each
 * runner's place ("T2" for a dead heat) or how its race ended, and the points from the contest's
 * points table as the total. Every number renders through the contest's participant scoring
 * definition (`PARTICIPANT_SCORING_DEFINITIONS`). Until the race is official no runner has
 * points, and a footnote says the places shown are provisional.
 */

import {
  PARTICIPANT_SCORING_DEFINITIONS,
  RaceResultStatus,
  type SportDefinition,
} from '@poolmaster/shared/domain';
import type { SportEventParticipantDto } from '@/lib/api';
import type { ScoringFamilyUi } from './types';

/** How a race that did not end in a place reads in the Finish column. */
const NON_FINISH_LABEL: Readonly<Record<Exclude<RaceResultStatus, typeof RaceResultStatus.FINISHED>, string>> = {
  [RaceResultStatus.DID_NOT_FINISH]: 'DNF',
  [RaceResultStatus.DISQUALIFIED]: 'DQ',
  [RaceResultStatus.DID_NOT_START]: 'DNS',
};

/**
 * The Finish cell: the runner's place (with the event standing's "T" for a dead heat), how its
 * race ended when it did not finish, the sport's word for a runner withdrawn before the start
 * ("Scratched"), or null (a dash) before a result is entered.
 */
export function formatFinish(participant: SportEventParticipantDto, sport: SportDefinition): string | null {
  const { race } = participant;
  if (!race) {
    return participant.isActive ? null : sport.vocabulary.withdrawn;
  }
  if (race.resultStatus === RaceResultStatus.FINISHED) {
    if (race.finishPosition === null) {
      return null;
    }
    return participant.standing?.displayPosition ?? String(race.finishPosition);
  }
  return NON_FINISH_LABEL[race.resultStatus];
}

export const finishPositionUi: ScoringFamilyUi = {
  // A race's points table breaks no ties with a prediction: entries submit without one.
  entryTiebreaker: null,
  leaderboard(response, sport) {
    const definition = PARTICIPANT_SCORING_DEFINITIONS[response.scoringDefinitionId];
    const provisional = response.participants.some((participant) => participant.race !== null && !participant.race.isOfficial);
    return {
      detailColumns: [
        { key: 'finish', label: 'Finish', testId: 'contest-leaderboard-finish-header', width: 'minmax(56px,0.4fr)' },
      ],
      footnote: provisional
        ? {
          testId: 'contest-leaderboard-provisional-note',
          text: `The finishing places shown are provisional: points count once the ${sport.vocabulary.round.one} result is official.`,
        }
        : null,
      entryTotal(entry) {
        const total = entry.race?.totalPoints ?? null;
        return total === null ? null : definition.format(total);
      },
      pickDetail(entryId, pick, participant) {
        const points = pick.race?.points ?? null;
        return {
          total: points === null ? null : definition.format(points),
          detailCells: [
            {
              key: 'finish',
              testId: `contest-leaderboard-pick-finish-${entryId}-${pick.pickId}`,
              text: formatFinish(participant, sport),
            },
          ],
        };
      },
    };
  },
};
