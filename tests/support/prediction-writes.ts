import type {
  ContestEntryMatchPredictionChange,
  ContestEntryMatchPredictionRepository,
  ContestEntryMatchPredictionSaveResult,
} from '@poolmaster/shared/db';

/**
 * Writes a change to an entry's picks for one event as given, whatever the week holds under the
 * entry's lock: a test's seed, or a test of the write itself. The service decides a change from
 * the locked week (#1268); a test that only needs the rows written does not.
 */
export function writePicks(
  predictions: Pick<ContestEntryMatchPredictionRepository, 'save'>,
  { contestEntryId, sportEventId, at, ...change }: { contestEntryId: string; sportEventId: string; at: Date } & ContestEntryMatchPredictionChange,
): Promise<ContestEntryMatchPredictionSaveResult> {
  return predictions.save({ contestEntryId, sportEventId, at, decide: () => change });
}
