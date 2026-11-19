/**
 * The automatic release job's handler (#1823, #1865): what each attempt leaves in Activity. A
 * hold for the same failed checks as before leaves no row; any other attempt reports its result.
 */
import { expect } from '@jest/globals';
import {
  JobErrorType,
  ReleaseAttemptOutcome,
  ReleaseAttemptSkipReason,
  ReleaseAttemptTrigger,
  ReleaseCheckKey,
  type ReleaseAttemptResult,
  type ReleaseCheck,
} from '@poolmaster/shared/domain';
import { DISCARD_BACKGROUND_JOB } from '../../../packages/core-api/src/modules/background-jobs';
import { releaseSportEventJobHandler } from '../../../packages/core-api/src/modules/events/release-sport-event-job';

const PAYLOAD = { sportEventId: 'sport-event-1', trigger: ReleaseAttemptTrigger.SCHEDULE };
const TIERS_MISSING: ReleaseCheck = { key: ReleaseCheckKey.TIERS_ASSIGNED, passed: false, value: 3 };

function handlerAnswering(attempt: ReleaseAttemptResult) {
  return releaseSportEventJobHandler({ autoReleaseEvent: async () => attempt });
}

describe('releaseSportEventJobHandler', () => {
  it('discards the job when the attempt held the event for the same failed checks as before', async () => {
    await expect(handlerAnswering({ outcome: ReleaseAttemptOutcome.HELD, checks: [TIERS_MISSING], sameHoldAsBefore: true })(PAYLOAD)).resolves.toBe(DISCARD_BACKGROUND_JOB);
  });

  it('reports a new or changed hold, and a release, with every check', async () => {
    await expect(handlerAnswering({ outcome: ReleaseAttemptOutcome.HELD, checks: [TIERS_MISSING], sameHoldAsBefore: false })(PAYLOAD))
      .resolves.toEqual({
        changedCount: 0,
        heldBack: JobErrorType.CHECK_FAILED,
        result: { outcome: ReleaseAttemptOutcome.HELD, checks: [expect.objectContaining({ key: ReleaseCheckKey.TIERS_ASSIGNED, passed: false })] },
      });
    await expect(handlerAnswering({ outcome: ReleaseAttemptOutcome.RELEASED, checks: [] })(PAYLOAD))
      .resolves.toEqual({ changedCount: 1, result: { outcome: ReleaseAttemptOutcome.RELEASED, checks: [] } });
  });

  it('reports a skipped attempt with why it was skipped', async () => {
    const skipped = { outcome: ReleaseAttemptOutcome.SKIPPED, reason: ReleaseAttemptSkipReason.NOT_DRAFT } as const;

    await expect(handlerAnswering(skipped)(PAYLOAD)).resolves.toEqual({ changedCount: 0, result: skipped });
  });
});
