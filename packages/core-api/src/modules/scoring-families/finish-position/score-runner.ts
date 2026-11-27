/**
 * Finish position (#622): a runner's contest score is the points its finishing place earns from
 * the contest's points table. The family's rules, all here:
 *
 * - An official FINISHED result scores `pointsTable[finishPosition - 1]`, and 0 for a place beyond
 *   the table. Runners in a dead heat share a place, so each scores that place's full points.
 * - An official DID_NOT_FINISH, DISQUALIFIED or DID_NOT_START result scores the contest's
 *   `didNotFinishPoints`.
 * - A runner withdrawn from the field (a scratched horse) with no result scores
 *   `didNotFinishPoints` once the race's result is official: a pick of it that was not swapped
 *   before the start is a non-starter (plans/racing-sports.md Q1.5, Q9.5).
 * - Anything else is unscored: no result yet, or a result not yet official. The family never
 *   invents a place for a runner the admin did not enter.
 */
import { GameSideStatus, MatchStatus, SportEventParticipantStatus, assertNever, type FinishPositionPointsSettings } from '@poolmaster/shared/domain';
import type { FieldGameResultView } from '@poolmaster/shared/db';
import type { SportEventParticipantView } from '../../events/sport-event-participant-service';

/** A runner's result in its race (#2008): its side result in the race's one FIELD Game, if it has one. */
export function raceResultOf(row: Pick<SportEventParticipantView, 'fieldResults'>): FieldGameResultView | null {
  return row.fieldResults[0] ?? null;
}

/** Whether the race's result is official: its Game is COMPLETED. */
export function isRaceOfficial(result: Pick<FieldGameResultView, 'gameStatus'> | null): boolean {
  return result?.gameStatus === MatchStatus.COMPLETED;
}

/** Whether the race's result is official, read off any runner with a result. */
export function isRaceResultOfficial(field: readonly SportEventParticipantView[]): boolean {
  return field.some((row) => isRaceOfficial(raceResultOf(row)));
}

/** The points a finishing place earns: the table's value at that place, 0 beyond the table. */
export function pointsForPlace(settings: FinishPositionPointsSettings, finishPosition: number): number {
  return settings.pointsTable[finishPosition - 1] ?? 0;
}

/** One runner's points in a contest under its settings, or null while unscored. */
export function scoreRunner(
  row: SportEventParticipantView,
  settings: FinishPositionPointsSettings,
  raceOfficial: boolean,
): number | null {
  const raced = raceResultOf(row);
  const result = raced?.result;
  if (result && isRaceOfficial(raced)) {
    // A side result with no status is not a race result: unscored, never given one.
    if (result.status === null) return null;
    switch (result.status) {
      case GameSideStatus.FINISHED:
        // Storage holds every official finisher to a place; a row without one stays unscored
        // rather than being given one.
        return result.position === null ? null : pointsForPlace(settings, result.position);
      case GameSideStatus.DID_NOT_FINISH:
      case GameSideStatus.DISQUALIFIED:
      case GameSideStatus.DID_NOT_START:
        return settings.didNotFinishPoints;
      default:
        return assertNever(result.status);
    }
  }
  if (!result && row.entry.status !== SportEventParticipantStatus.ACTIVE && raceOfficial) {
    return settings.didNotFinishPoints;
  }
  return null;
}
