import { useState } from 'react';
import { Check, ChevronRight, Minus } from 'lucide-react';
import type { LeaguePlan, PlanCap, PlanFeatureGroup } from '@poolmaster/shared/domain';
import {
  Button,
  cn,
  SimpleTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tile,
} from '@/features/shared/ui';
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
      <SimpleTable className="text-xs sm:text-sm">
        <TableHead tone="plain">
          <tr>
            <TableHeaderCell className="sticky left-0 bg-card px-3 text-muted-foreground">
              <span className="sr-only">What the plan includes</span>
            </TableHeaderCell>
            {plans.map((plan, index) => (
              <TableHeaderCell align="center" className={cn('px-1 font-display font-bold sm:px-2', shade(index))} key={plan.plan}>
                {LEAGUE_PLAN_LABEL[plan.plan]}
              </TableHeaderCell>
            ))}
          </tr>
        </TableHead>
        {sections.map((section) => {
          const group = section.group;
          const isFolded = group !== null && folded.has(group);
          return (
            <TableBody data-testid={`plan-comparison-section-${section.key}`} key={section.key}>
              <TableRow className="bg-muted">
                <TableHeaderCell className="sticky left-0 bg-muted px-3 text-xs font-semibold uppercase tracking-eyebrow text-muted-foreground" colSpan={isFolded ? 1 : plans.length + 1} scope="rowgroup">
                  {group === null ? section.title : (
                    <Button
                      aria-expanded={!isFolded}
                      className="h-auto gap-1 p-0 text-xs font-semibold uppercase tracking-eyebrow text-muted-foreground"
                      data-testid={`plan-comparison-toggle-${section.key}`}
                      onClick={() => toggle(group)}
                      size="auto"
                      variant="ghost"
                    >
                      <ChevronRight aria-hidden className={cn('transition-transform', isFolded ? null : 'rotate-90')} size={14} />
                      {section.title}
                    </Button>
                  )}
                </TableHeaderCell>
                {isFolded ? foldedCounts(section, plans.length).map((count, index) => (
                  <TableCell align="center" className={cn('px-1 text-xs font-semibold text-muted-foreground sm:px-2', shade(index))} key={plans[index]?.plan ?? index} numeric>{count}</TableCell>
                )) : null}
              </TableRow>
              {isFolded ? null : section.rows.map((row) => (
                <TableRow data-testid={`plan-comparison-row-${row.key}`} key={row.key}>
                  <TableHeaderCell className="sticky left-0 bg-card px-2 font-normal sm:px-3" scope="row">
                    {row.label}
                    <span className="hidden text-xs text-muted-foreground sm:block">{row.description}</span>
                  </TableHeaderCell>
                  {row.cells.map((cell, index) => {
                    const used = row.cap === null ? undefined : capUsage?.[row.cap];
                    const limit = row.cap === null ? null : plans[index]?.caps[row.cap] ?? null;
                    return (
                      <TableCell align="center" className={cn('px-1 sm:px-2', shade(index))} key={plans[index]?.plan ?? index} numeric>
                        {typeof cell === 'string' ? cell : cell
                          ? <Check aria-label="Included" className="mx-auto text-primary" size={16} />
                          : <Minus aria-label="Not included" className="mx-auto text-muted-foreground" size={16} />}
                        {used !== undefined && limit !== null && used > limit ? (
                          <span className="block text-xs font-semibold text-destructive" data-testid={`plan-comparison-over-${row.key}-${plans[index]?.plan ?? index}`}>
                            You use {used.toLocaleString('en-US')}
                          </span>
                        ) : null}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          );
        })}
      </SimpleTable>
    </Tile>
  );
}
