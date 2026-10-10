import { DEFAULT_BUDGET_PRICING_PROFILES } from '@poolmaster/shared/domain';
import { BUDGET_PRICING_SETTINGS } from '../../../packages/core-api/src/modules/events/budget-pricing-settings';

// The Budget pricing settings group (#93): what a save is refused for beyond the JSON shape.

const [standard, small] = DEFAULT_BUDGET_PRICING_PROFILES;

describe('BUDGET_PRICING_SETTINGS', () => {
  it('defaults to the Standard ($50,000 cap, $100 unit) and Small ($5,000 cap, $10 unit) profiles, Standard first', () => {
    expect(BUDGET_PRICING_SETTINGS.defaults({}).profiles).toEqual([
      { name: 'Standard', salaryCap: 50000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
      { name: 'Small', salaryCap: 5000, unit: 10, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
    ]);
  });

  it('refuses two profiles with the same name, whatever their case', () => {
    const result = BUDGET_PRICING_SETTINGS.schema.safeParse({ profiles: [standard, { ...small, name: 'STANDARD' }] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Another profile is already named "STANDARD".');
  });

  it('refuses a profile whose worst seed would cost more than its best', () => {
    const result = BUDGET_PRICING_SETTINGS.schema.safeParse({ profiles: [{ ...standard, floorSharePercent: 30 }] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['profiles', 0]);
  });

  it('refuses a settings value with no profile at all', () => {
    expect(BUDGET_PRICING_SETTINGS.schema.safeParse({ profiles: [] }).success).toBe(false);
  });
});
