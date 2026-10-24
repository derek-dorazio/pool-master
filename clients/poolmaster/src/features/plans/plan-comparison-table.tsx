import { useState } from 'react';
import { Check, ChevronRight, Minus } from 'lucide-react';
import type { PlanFeatureGroup } from '@poolmaster/shared/domain';
import { Button, cn } from '@/features/shared/ui';
import { LEAGUE_PLAN_LABEL } from './plan-labels';
import { buildPlanComparison, type ComparedPlan, type PlanComparisonSection } from './plan-comparison';

interface PlanComparisonTableProps {
  plans: readonly ComparedPlan[];
  /** Feature groups that start folded to one row of counts ("4 of 11"); a reader can open them. */
  initiallyFolded?: readonly PlanFeatureGroup[];
}

/** How many of a folded group's rows each plan has, as its summary cells. */
function foldedCounts(section: PlanComparisonSection, planCount: number): string[] {
  return Array.from({ length: planCount }, (_unused, index) => {
    const included = section.rows.filter((row) => row.cells[index] === true).length;
    return `${included} of ${section.rows.length}`;
  });
}

/**
 * Every plan side by side (#945, #971): its limits, what every plan includes, then which
 * features it has, each row lined up across the plans. The first column stays put while the
 * table scrolls sideways on a phone.
 */
export function PlanComparisonTable({ plans, initiallyFolded = [] }: PlanComparisonTableProps) {
  const sections = buildPlanComparison(plans);
  const [folded, setFolded] = useState<ReadonlySet<PlanFeatureGroup>>(() => new Set(initiallyFolded));
  const toggle = (group: PlanFeatureGroup) => setFolded((current) => {
    const next = new Set(current);
    if (next.has(group)) {
      next.delete(group);
    } else {
      next.add(group);
    }
    return next;
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card" data-testid="plan-comparison-table">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="sticky left-0 bg-card px-3 py-2 font-medium text-muted-foreground" scope="col">
              <span className="sr-only">What the plan includes</span>
            </th>
            {plans.map((plan) => (
              <th className="px-2 py-2 text-center font-display font-bold" key={plan.plan} scope="col">
                {LEAGUE_PLAN_LABEL[plan.plan]}
              </th>
            ))}
          </tr>
        </thead>
        {sections.map((section) => {
          const group = section.group;
          const isFolded = group !== null && folded.has(group);
          return (
            <tbody data-testid={`plan-comparison-section-${section.key}`} key={section.key}>
              <tr className="bg-muted/40">
                <th className="sticky left-0 bg-muted px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground" colSpan={isFolded ? 1 : plans.length + 1} scope="colgroup">
                  {group === null ? section.title : (
                    <Button
                      aria-expanded={!isFolded}
                      className="h-auto gap-1 p-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      data-testid={`plan-comparison-toggle-${section.key}`}
                      onClick={() => toggle(group)}
                      size="auto"
                      variant="ghost"
                    >
                      <ChevronRight aria-hidden className={cn('transition-transform', isFolded ? null : 'rotate-90')} size={14} />
                      {section.title}
                    </Button>
                  )}
                </th>
                {isFolded ? foldedCounts(section, plans.length).map((count, index) => (
                  <td className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground tabular-nums" key={plans[index]?.plan ?? index}>{count}</td>
                )) : null}
              </tr>
              {isFolded ? null : section.rows.map((row) => (
                <tr className="border-t border-border" data-testid={`plan-comparison-row-${row.key}`} key={row.key}>
                  <th className="sticky left-0 bg-card px-3 py-2 text-left font-normal" scope="row">
                    {row.label}
                    <span className="block text-xs text-muted-foreground">{row.description}</span>
                  </th>
                  {row.cells.map((cell, index) => (
                    <td className="px-2 py-2 text-center tabular-nums" key={plans[index]?.plan ?? index}>
                      {typeof cell === 'string' ? cell : cell
                        ? <Check aria-label="Included" className="mx-auto text-primary" size={16} />
                        : <Minus aria-label="Not included" className="mx-auto text-muted-foreground" size={16} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
