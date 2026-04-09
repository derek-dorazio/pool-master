import type {
  ContestParticipantSourceDataRecord,
  ComputedContestEntryParticipantScore,
  ComputedContestEntryParticipantScoreEvent,
  ScoreContestEntryContext,
  ScoreableRosterPick,
} from './types';

export function findRosterPick(
  context: ScoreContestEntryContext,
  rosterPickId: string,
): ScoreableRosterPick | undefined {
  return context.rosterPicks.find((pick) => pick.id === rosterPickId);
}

export function findParticipantSourceData(
  context: ScoreContestEntryContext,
  rosterPickId: string,
): ContestParticipantSourceDataRecord | undefined {
  const rosterPick = findRosterPick(context, rosterPickId);
  if (!rosterPick) {
    return undefined;
  }

  return context.sourceData.find(
    (item) => item.sportEventParticipantId === rosterPick.sportEventParticipantId,
  );
}

export function getNormalizedData<T>(
  sourceData: ContestParticipantSourceDataRecord | undefined,
): T | undefined {
  return sourceData?.normalizedData as T | undefined;
}

export function rebuildContestEntryParticipantScores(
  rosterPicks: ScoreableRosterPick[],
  scoreEvents: ComputedContestEntryParticipantScoreEvent[],
): ComputedContestEntryParticipantScore[] {
  return rosterPicks.map((pick) => ({
    rosterPickId: pick.id,
    pointsEarned: scoreEvents
      .filter((event) => event.rosterPickId === pick.id)
      .reduce((sum, event) => sum + event.points, 0),
  }));
}
