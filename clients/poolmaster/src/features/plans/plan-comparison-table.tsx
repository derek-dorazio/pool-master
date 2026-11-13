import { useState } from 'react';
import { Check, Minus } from 'lucide-react';
import type { LeaguePlan, PlanCap, PlanFeatureGroup } from '@poolmaster/shared/domain';
import {
  cn,
  HelpTip,
  Icon,
  SimpleTable,
  TableBody,
  TableCell,
  TableGroupRow,
  TableHead,
  TableHeaderCell,
  TableRow,
  formatNumber,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { LEAGUE_PLAN_LABEL } from './plan-labels';
import { buildPlanComparison, type ComparedPlan, type PlanComparisonSection } from './plan-comparison';

interface PlanComparisonTableProps {
  plans: readonly ComparedPlan[];
  /** Feature groups that start folded to one row of counts ("4 of 11"); a reader can open them. */
  initiallyFolded?: readonly PlanFeatureGroup[];
  /**
   * The one plan whose column is tinted: the league's own plan on its Plan page (#972), the plan
   * new leagues are gifted on the public Plans page (#1614). None when left out or null.
   */
  highlightedPlan?: LeaguePlan | null;
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
 * features it has, each row lined up across the plans. Each row's description sits behind a (?)
 * on its name (#1614), so all four plans fit a phone; the first column stays put if the table
 * still has to scroll. One plan's column can be tinted, and on a league's Plan page (#972) a cap
 * below what the league uses says so. It sits inside a section card, so it draws no frame.
 */
export function PlanComparisonTable({ plans, initiallyFolded = [], highlightedPlan = null, capUsage }: PlanComparisonTableProps) {
  const tint = (index: number) => (highlightedPlan !== null && plans[index]?.plan === highlightedPlan ? 'bg-primary/10' : null);
  const { locale } = useDisplayPreferences();
  const sections = buildPlanComparison(plans, locale);
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
    <div className="overflow-x-auto" data-testid="plan-comparison-table">
      <SimpleTable className="text-xs sm:text-sm">
        <TableHead tone="plain">
          <tr>
            <TableHeaderCell className="sticky left-0 bg-card px-3 text-muted-foreground">
              <span className="sr-only">What the plan includes</span>
            </TableHeaderCell>
            {plans.map((plan, index) => (
              <TableHeaderCell
                align="center"
                className={cn('px-1 font-display font-bold sm:px-2', tint(index))}
                data-highlighted={tint(index) ? true : undefined}
                data-testid={`plan-comparison-column-${plan.plan}`}
                key={plan.plan}
              >
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
              <TableGroupRow
                cells={isFolded ? foldedCounts(section, plans.length).map((count, index) => (
                  <TableCell align="center" className={cn('px-1 text-xs font-semibold text-muted-foreground sm:px-2', tint(index))} key={plans[index]?.plan ?? index} numeric>{count}</TableCell>
                )) : null}
                colSpan={isFolded ? 1 : plans.length + 1}
                isOpen={!isFolded}
                label={section.title}
                labelClassName="sticky left-0 px-3"
                onToggle={group === null ? undefined : () => toggle(group)}
                toggleTestId={`plan-comparison-toggle-${section.key}`}
              />
              {isFolded ? null : section.rows.map((row) => (
                <TableRow data-testid={`plan-comparison-row-${row.key}`} key={row.key}>
                  <TableHeaderCell className="sticky left-0 bg-card px-2 font-normal sm:px-3" scope="row">
                    <span className="inline-flex items-center gap-1">
                      {row.label}
                      <HelpTip label={`About ${row.label}`} testId={`plan-comparison-help-${row.key}`}>{row.description}</HelpTip>
                    </span>
                  </TableHeaderCell>
                  {row.cells.map((cell, index) => {
                    const used = row.cap === null ? undefined : capUsage?.[row.cap];
                    const limit = row.cap === null ? null : plans[index]?.caps[row.cap] ?? null;
                    return (
                      <TableCell align="center" className={cn('px-1 sm:px-2', tint(index))} key={plans[index]?.plan ?? index} numeric>
                        {typeof cell === 'string' ? cell : (
                          <>
                            <Icon className="mx-auto" icon={cell ? Check : Minus} size={16} tone={cell ? 'primary' : 'muted'} />
                            <span className="sr-only">{cell ? 'Included' : 'Not included'}</span>
                          </>
                        )}
                        {used !== undefined && limit !== null && used > limit ? (
                          <span className="block text-xs font-semibold text-destructive" data-testid={`plan-comparison-over-${row.key}-${plans[index]?.plan ?? index}`}>
                            You use {formatNumber(used, locale)}
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
    </div>
  );
}
