/**
 * The shape of a finishing order (#622), read from the places alone. The server checks it and
 * never repairs it: the admin enters every place.
 */
import { ParticipantStandingStatus, RaceResultStatus, assertNever } from '@poolmaster/shared/domain';

/**
 * Whether finishing places form a finishing order: they run 1, 2, 3 ... and a dead heat repeats a
 * place and skips as many after it (1, 2, 2, 4), the same standard competition ranking every
 * standing uses. A gap (1, 3) or a tie that does not skip (1, 2, 2, 3) is not one. No places at
 * all is an order nobody has entered yet.
 */
export function placesFormFinishingOrder(places: readonly number[]): boolean {
  const sorted = [...places].sort((left, right) => left - right);
  return sorted.every((place, index) => place === (index > 0 && place === sorted[index - 1] ? sorted[index - 1] : index + 1));
}

/** A place as shown on a standing: "T2" for runners in a dead heat, else the place itself. */
export function displayPlace(place: number, places: readonly number[]): string {
  const sharing = places.filter((candidate) => candidate === place).length;
  return sharing > 1 ? `T${place}` : String(place);
}

/**
 * A runner's standing status in the event from how its race ended: a runner that started is done
 * with the event, finished or not; one that did not start is out of it.
 */
export function standingStatusForResult(resultStatus: RaceResultStatus): ParticipantStandingStatus {
  switch (resultStatus) {
    case RaceResultStatus.FINISHED:
    case RaceResultStatus.DID_NOT_FINISH:
    case RaceResultStatus.DISQUALIFIED:
      return ParticipantStandingStatus.COMPLETE;
    case RaceResultStatus.DID_NOT_START:
      return ParticipantStandingStatus.WITHDRAWN;
    default:
      return assertNever(resultStatus);
  }
}
