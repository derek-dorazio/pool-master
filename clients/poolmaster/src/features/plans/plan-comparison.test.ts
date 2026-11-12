import { describe, expect, it } from 'vitest';
import { PlanFeature } from '@poolmaster/shared/domain';
import { buildPlanComparison } from './plan-comparison';
import { buildPlanEntitlements } from './test/fixtures';

describe('buildPlanComparison', () => {
  it('lists the limits first, then what every plan includes, then emails, championships and history, each feature once with its description', () => {
    const sections = buildPlanComparison([buildPlanEntitlements()], 'en-US');

    expect(sections.map((section) => section.title)).toEqual(['Limits', 'In every plan', 'Emails', 'Championships', 'History']);
    expect(sections[0]?.rows.map((row) => row.label)).toEqual(['Entries per contest', 'Sports leagues a year']);
    expect(sections.slice(2).flatMap((section) => section.rows.map((row) => row.key)).sort())
      .toEqual(Object.values(PlanFeature).sort());
    expect(sections.flatMap((section) => section.rows).every((row) => row.description.length > 0)).toBe(true);
  });

  it('shows what every plan includes the same on every plan, whatever the plan settings say', () => {
    const sections = buildPlanComparison([buildPlanEntitlements({ plan: 'FREE', features: [] }), buildPlanEntitlements()], 'en-US');
    const included = sections.find((section) => section.key === 'included');

    expect(included?.group).toBeNull();
    expect(included?.rows.find((row) => row.key === 'members')?.cells).toEqual(['Unlimited', 'Unlimited']);
    expect(included?.rows.find((row) => row.key === 'contest-types')?.cells).toEqual([true, true]);
  });

  it('marks a feature only under the plans that include it, and shows a limit as a number in the viewer\'s locale or Unlimited', () => {
    const plans = [
      buildPlanEntitlements({ plan: 'FREE', caps: { ENTRIES_PER_CONTEST: 1500, SPORTS_LEAGUES_PER_YEAR: 1 }, features: [] }),
      buildPlanEntitlements(),
    ];
    const rows = buildPlanComparison(plans, 'en-US').flatMap((section) => section.rows);
    const germanRows = buildPlanComparison(plans, 'en-DE').flatMap((section) => section.rows);

    expect(rows.find((row) => row.key === 'ENTRIES_PER_CONTEST')?.cells).toEqual(['1,500', 'Unlimited']);
    expect(germanRows.find((row) => row.key === 'ENTRIES_PER_CONTEST')?.cells).toEqual(['1.500', 'Unlimited']);
    expect(rows.find((row) => row.key === PlanFeature.RECORD_BOOK)?.cells).toEqual([false, true]);
  });
});
