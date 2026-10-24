import { Check, Minus } from 'lucide-react';
import { LEAGUE_PLAN_LABEL } from './plan-labels';
import { buildPlanComparison, type ComparedPlan } from './plan-comparison';

/** Every plan side by side (#945): its limits, then which features it has. */
export function PlanComparisonTable({ plans }: { plans: readonly ComparedPlan[] }) {
  const sections = buildPlanComparison(plans);
  return (
    <div className="overflow-x-auto rounded-xl border border-border" data-testid="plan-comparison-table">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="px-3 py-2 font-medium text-muted-foreground" scope="col">
              <span className="sr-only">What the plan includes</span>
            </th>
            {plans.map((plan) => (
              <th className="px-3 py-2 text-center font-semibold" key={plan.plan} scope="col">
                {LEAGUE_PLAN_LABEL[plan.plan]}
              </th>
            ))}
          </tr>
        </thead>
        {sections.map((section) => (
          <tbody key={section.key}>
            <tr className="bg-muted/40">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground" colSpan={plans.length + 1} scope="colgroup">
                {section.title}
              </th>
            </tr>
            {section.rows.map((row) => (
              <tr className="border-t border-border" data-testid={`plan-comparison-row-${row.key}`} key={row.key}>
                <th className="px-3 py-2 text-left font-normal" scope="row">{row.label}</th>
                {row.cells.map((cell, index) => (
                  <td className="px-3 py-2 text-center tabular-nums" key={plans[index]?.plan ?? index}>
                    {typeof cell === 'string' ? cell : cell
                      ? <Check aria-label="Included" className="mx-auto text-primary" size={16} />
                      : <Minus aria-label="Not included" className="mx-auto text-muted-foreground" size={16} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
