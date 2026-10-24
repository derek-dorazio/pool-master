import { LeaguePlan, findFallingPlanLimit } from '@poolmaster/shared/domain';

// The one rule a plan's caps follow (#944): a limit never falls as the plan rises.

describe('findFallingPlanLimit', () => {
  it('finds nothing when every limit is at least the one below it, unlimited last', () => {
    expect(findFallingPlanLimit({ FREE: 20, PRO: 20, PREMIUM: 100 })).toBeNull();
  });

  it('names the first plan whose limit is below the plan beneath it', () => {
    expect(findFallingPlanLimit({ FREE: 20, PRO: 10, PREMIUM: 5 })).toBe(LeaguePlan.PRO);
  });

  it('names a plan with a number above a plan that is unlimited', () => {
    expect(findFallingPlanLimit({ FREE: null, PRO: 50, PREMIUM: null })).toBe(LeaguePlan.PRO);
  });

  it('finds nothing when every plan is unlimited', () => {
    expect(findFallingPlanLimit({ FREE: null, PRO: null, PREMIUM: null })).toBeNull();
  });
});
