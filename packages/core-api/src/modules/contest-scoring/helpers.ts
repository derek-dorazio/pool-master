import type {
  ContestParticipantSourceDataRecord,
  ComputedContestEntryParticipantScore,
  ComputedContestEntryParticipantScoreEvent,
  ScoreContestEntryContext,
  ScoreableContestEntryPick,
} from './types';

export function findContestEntryPick(
  context: ScoreContestEntryContext,
  pickId: string,
): ScoreableContestEntryPick | undefined {
  return context.picks.find((pick) => pick.id === pickId);
}

export function findParticipantSourceData(
  context: ScoreContestEntryContext,
  pickId: string,
): ContestParticipantSourceDataRecord | undefined {
  const pick = findContestEntryPick(context, pickId);
  if (!pick) {
    return undefined;
  }

  return context.sourceData.find(
    (item) => item.sportEventParticipantId === pick.sportEventParticipantId,
  );
}

export function getNormalizedData<T>(
  sourceData: ContestParticipantSourceDataRecord | undefined,
): T | undefined {
  return sourceData?.normalizedData as T | undefined;
}

export function rebuildContestEntryParticipantScores(
  picks: ScoreableContestEntryPick[],
  scoreEvents: ComputedContestEntryParticipantScoreEvent[],
): ComputedContestEntryParticipantScore[] {
  return picks.map((pick) => ({
    pickId: pick.id,
    pointsEarned: scoreEvents
      .filter((event) => event.pickId === pick.id)
      .reduce((sum, event) => sum + event.points, 0),
  }));
}
