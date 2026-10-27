import { useState } from 'react';
import { Check, ChevronRight, Minus } from 'lucide-react';
import type { LeaguePlan, PlanCap, PlanFeatureGroup } from '@poolmaster/shared/domain';
import { Button, Tile, cn } from '@/features/shared/ui';
import { LEAGUE_PLAN_LABEL } from './plan-labels';
import { buildPlanComparison, type ComparedPlan, type PlanComparisonSection } from './plan-comparison';

interface PlanComparisonTableProps {
  plans: readonly ComparedPlan[];
  /** Feature groups that start folded to one row of counts ("4 of 11"); a reader can open them. */
  initiallyFolded?: readonly PlanFeatureGroup[];
  /** The league's own plan, whose column is shaded (#972). */
  currentPlan?: LeaguePlan;
  /** What the league uses of each cap now; a plan whose cap is below it says "You use N" there. */
  capUsage?: Readonly<Record<PlanCap, number>>;
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
 * features it has, each row lined up across the plans. On a phone the descriptions drop so all
 * four plans fit; the first column stays put if the table still has to scroll. On a league's
 * Plan page (#972) its plan's column is shaded, and a cap below what the league uses says so.
 */
export function PlanComparisonTable({ plans, initiallyFolded = [], currentPlan, capUsage }: PlanComparisonTableProps) {
  const shade = (index: number) => (plans[index]?.plan === currentPlan ? 'bg-primary/10' : null);
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
    <Tile className="overflow-x-auto" data-testid="plan-comparison-table" padding="none" radius="md">
      <table className="w-full text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="sticky left-0 bg-card px-3 py-2 font-medium text-muted-foreground" scope="col">
              <span className="sr-only">What the plan includes</span>
            </th>
            {plans.map((plan, index) => (
              <th className={cn('px-1 py-2 text-center font-display font-bold sm:px-2', shade(index))} key={plan.plan} scope="col">
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
              <tr className="bg-muted">
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
                  <td className={cn('px-1 py-2 text-center text-xs font-semibold text-muted-foreground tabular-nums sm:px-2', shade(index))} key={plans[index]?.plan ?? index}>{count}</td>
                )) : null}
              </tr>
              {isFolded ? null : section.rows.map((row) => (
                <tr className="border-t border-border" data-testid={`plan-comparison-row-${row.key}`} key={row.key}>
                  <th className="sticky left-0 bg-card px-2 py-2 text-left font-normal sm:px-3" scope="row">
                    {row.label}
                    <span className="hidden text-xs text-muted-foreground sm:block">{row.description}</span>
                  </th>
                  {row.cells.map((cell, index) => {
                    const used = row.cap === null ? undefined : capUsage?.[row.cap];
                    const limit = row.cap === null ? null : plans[index]?.caps[row.cap] ?? null;
                    return (
                      <td className={cn('px-1 py-2 text-center tabular-nums sm:px-2', shade(index))} key={plans[index]?.plan ?? index}>
                        {typeof cell === 'string' ? cell : cell
                          ? <Check aria-label="Included" className="mx-auto text-primary" size={16} />
                          : <Minus aria-label="Not included" className="mx-auto text-muted-foreground" size={16} />}
                        {used !== undefined && limit !== null && used > limit ? (
                          <span className="block text-xs font-semibold text-destructive" data-testid={`plan-comparison-over-${row.key}-${plans[index]?.plan ?? index}`}>
                            You use {used.toLocaleString('en-US')}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </Tile>
  );
}
