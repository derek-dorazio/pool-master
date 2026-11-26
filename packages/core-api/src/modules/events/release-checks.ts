/**
 * The ready checks of a DRAFT event's release (#1823), judged in one place for the manual
 * "Release for contests", the automatic release job and the root admin's event read. Each check
 * says whether it passed and the value it was judged on; a check that does not apply to the
 * event (a bracket for an event not played as matches, provider links for an unsynced event) is
 * left out rather than passed.
 */

import { assertNever, ReleaseCheckKey, type ReleaseCheck, type SportNoun } from '@poolmaster/shared/domain';
import { tierLabel } from '@poolmaster/shared/display-strings';

/** What the checks are judged on: the event's admin counts and its release facts. */
export interface ReleaseCheckInputs {
  startDate: Date;
  now: Date;
  scheduledRoundCount: number;
  loadedParticipantCount: number;
  untieredParticipantCount: number;
  emptyTierNumbers: readonly number[];
  isPriced: boolean;
  unpricedParticipantCount: number;
  /** What its bracket still lacks; null for an event not played as matches. */
  bracketBlockers: readonly string[] | null;
  contestSetupCount: number;
}

export function evaluateReleaseChecks(inputs: ReleaseCheckInputs): ReleaseCheck[] {
  const checks: ReleaseCheck[] = [
    { key: ReleaseCheckKey.NOT_STARTED, passed: inputs.startDate.getTime() > inputs.now.getTime(), value: inputs.startDate },
    { key: ReleaseCheckKey.ROUNDS_SCHEDULED, passed: inputs.scheduledRoundCount > 0, value: inputs.scheduledRoundCount },
    { key: ReleaseCheckKey.FIELD_LOADED, passed: inputs.loadedParticipantCount > 0, value: inputs.loadedParticipantCount },
  ];
  checks.push(
    { key: ReleaseCheckKey.TIERS_ASSIGNED, passed: inputs.untieredParticipantCount === 0, value: inputs.untieredParticipantCount },
    { key: ReleaseCheckKey.TIERS_FILLED, passed: inputs.emptyTierNumbers.length === 0, value: [...inputs.emptyTierNumbers] },
    inputs.isPriced
      ? { key: ReleaseCheckKey.PRICES_ASSIGNED, passed: inputs.unpricedParticipantCount === 0, value: inputs.unpricedParticipantCount }
      : { key: ReleaseCheckKey.PRICES_ASSIGNED, passed: false, value: null },
  );
  if (inputs.bracketBlockers !== null) {
    checks.push({ key: ReleaseCheckKey.BRACKET_COMPLETE, passed: inputs.bracketBlockers.length === 0, value: [...inputs.bracketBlockers] });
  }
  checks.push({ key: ReleaseCheckKey.CONTEST_SETUPS_ON, passed: inputs.contestSetupCount > 0, value: inputs.contestSetupCount });
  return checks;
}

export function failedReleaseChecks(checks: readonly ReleaseCheck[]): ReleaseCheck[] {
  return checks.filter((check) => !check.passed);
}

/**
 * A failed check in the words a release refusal and the "event still in draft" email use ("its
 * field is not loaded"); a bracket check gives one phrase per thing it lacks.
 */
export function describeFailedReleaseCheck(check: ReleaseCheck, participant: SportNoun): string[] {
  switch (check.key) {
    case ReleaseCheckKey.NOT_STARTED:
      return ['its start time has passed'];
    case ReleaseCheckKey.ROUNDS_SCHEDULED:
      return ['its rounds are not scheduled'];
    case ReleaseCheckKey.FIELD_LOADED:
      return ['its field is not loaded'];
    case ReleaseCheckKey.TIERS_ASSIGNED:
      return [`${check.value} active participant(s) have no tier`];
    case ReleaseCheckKey.TIERS_FILLED:
      return check.value.map((tierNumber) => `${tierLabel(tierNumber)} has no ${participant.many}`);
    case ReleaseCheckKey.PRICES_ASSIGNED:
      return check.value === null ? ['its prices have not been assigned'] : [`${check.value} active participant(s) have no price`];
    case ReleaseCheckKey.BRACKET_COMPLETE:
      return check.value;
    case ReleaseCheckKey.CONTEST_SETUPS_ON:
      return ['its sport league has no active contest setup'];
    default:
      return assertNever(check);
  }
}
