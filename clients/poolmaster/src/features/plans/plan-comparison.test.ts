import { describe, expect, it } from 'vitest';
import { PlanFeature } from '@poolmaster/shared/domain';
import { buildPlanComparison } from './plan-comparison';
import { buildPlanEntitlements } from './test/fixtures';

describe('buildPlanComparison', () => {
  it('lists the limits first, then emails, championships and history, each feature once', () => {
    const sections = buildPlanComparison([buildPlanEntitlements()]);

    expect(sections.map((section) => section.title)).toEqual(['Limits', 'Emails', 'Championships', 'History']);
    expect(sections[0]?.rows.map((row) => row.label)).toEqual(['Entries per contest', 'Sports leagues a year']);
    expect(sections.slice(1).flatMap((section) => section.rows.map((row) => row.key)).sort())
      .toEqual(Object.values(PlanFeature).sort());
  });

  it('marks a feature only under the plans that include it, and shows a limit as a number or Unlimited', () => {
    const sections = buildPlanComparison([
      buildPlanEntitlements({ plan: 'FREE', caps: { ENTRIES_PER_CONTEST: 1500, SPORTS_LEAGUES_PER_YEAR: 1 }, features: [] }),
      buildPlanEntitlements(),
    ]);
    const rows = sections.flatMap((section) => section.rows);

    expect(rows.find((row) => row.key === 'ENTRIES_PER_CONTEST')?.cells).toEqual(['1,500', 'Unlimited']);
    expect(rows.find((row) => row.key === PlanFeature.RECORD_BOOK)?.cells).toEqual([false, true]);
  });
});
