import { ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { CONTEST_LIFECYCLE_STAGES, contestLifecycleStage } from './contest-lifecycle';

describe('contestLifecycleStage', () => {
  it('runs Set up, Open, Live, Final in that order', () => {
    expect(CONTEST_LIFECYCLE_STAGES).toEqual(['Set up', 'Open', 'Live', 'Final']);
  });

  it('puts each contest status at its own stage, so the track and the badge name the same one', () => {
    expect(contestLifecycleStage(ContestStatus.DRAFT)).toEqual({ index: 0, label: 'Set up' });
    expect(contestLifecycleStage(ContestStatus.OPEN)).toEqual({ index: 1, label: 'Open' });
    expect(contestLifecycleStage(ContestStatus.ACTIVE)).toEqual({ index: 2, label: 'Live' });
    expect(contestLifecycleStage(ContestStatus.COMPLETED)).toEqual({ index: 3, label: 'Final' });
  });
});
