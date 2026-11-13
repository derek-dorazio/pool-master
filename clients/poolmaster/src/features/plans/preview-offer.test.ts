import { describe, expect, it } from 'vitest';
import { LeaguePlan } from '@poolmaster/shared/domain';
import { previewOffer } from './preview-offer';

describe('previewOffer', () => {
  it('names the gifted plan and how many months it runs', () => {
    expect(previewOffer({ previewPlan: LeaguePlan.PREMIUM, previewPeriodMonths: 6 })).toBe('Premium free for 6 months');
  });

  it('follows whichever plan the preview gives', () => {
    expect(previewOffer({ previewPlan: LeaguePlan.PRO, previewPeriodMonths: 3 })).toBe('Pro free for 3 months');
  });

  it('is null while no preview is offered, so no offer is shown', () => {
    expect(previewOffer({ previewPlan: null, previewPeriodMonths: 6 })).toBeNull();
  });
});
