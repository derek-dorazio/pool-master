import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { LeaguePlan } from '@poolmaster/shared/domain';
import type { LeaguePlanListResponse } from '@/lib/api';
import { describeExpansionPrices } from '@/features/billing/billing-format';
import { Tile } from '@/features/shared/ui';
import type { ComparedPlan } from './plan-comparison';
import { buildPlanHighlights } from './plan-highlights';
import { LEAGUE_PLAN_LABEL, LEAGUE_PLAN_TAGLINE } from './plan-labels';

interface PlanCardsProps {
  plans: readonly ComparedPlan[];
  /** The button or note at the foot of each card's price, which differs by page. */
  renderAction: (plan: LeaguePlan) => ReactNode;
  /** Each plan's contest expansion prices, shown under its price when given (#973). */
  expansion?: Pick<LeaguePlanListResponse, 'expansionPrices' | 'paymentsEnabled'>;
}

/**
 * One card per plan, lowest first (#971): name, who it is for, price, the page's action, then
 * what the plan adds to the one below. Every card has the same rows in the same order, so they
 * line up side by side; on a phone they stack.
 *
 * There are no plan prices yet: the lowest plan is $0 and every other plan is free for now. Yearly
 * prices come with payments (#931). A contest expansion's price is shown when given.
 */
export function PlanCards({ expansion, plans, renderAction }: PlanCardsProps) {
  const highlights = buildPlanHighlights(plans);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="plan-cards">
      {highlights.map((card, index) => (
        <Tile className="flex flex-col gap-4" data-testid={`plan-card-${card.plan}`} key={card.plan} padding="md" radius="md">
          <div className="space-y-1">
            <h3 className="font-display text-2xl font-bold italic text-foreground">{LEAGUE_PLAN_LABEL[card.plan]}</h3>
            <p className="min-h-10 text-sm text-muted-foreground">{LEAGUE_PLAN_TAGLINE[card.plan]}</p>
          </div>
          <p className="flex items-baseline gap-1.5" data-testid={`plan-card-${card.plan}-price`}>
            <span className="font-display text-3xl font-bold text-foreground">{index === 0 ? '$0' : 'Free'}</span>
            {index === 0 ? null : <span className="text-sm text-muted-foreground">for now</span>}
          </p>
          {renderAction(card.plan)}
          {expansion && expansion.expansionPrices[card.plan].length > 0 ? (
            <div className="space-y-1 text-sm" data-testid={`plan-card-${card.plan}-expansion`}>
              <p className="text-foreground">Bigger contests: {describeExpansionPrices(expansion.expansionPrices[card.plan])}</p>
              {expansion.paymentsEnabled ? null : <p className="text-muted-foreground">Expanding is free for now.</p>}
            </div>
          ) : null}
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {card.adds === null ? 'Included' : `Everything in ${LEAGUE_PLAN_LABEL[card.adds]}, plus`}
            </p>
            <ul className="space-y-2 text-sm" data-testid={`plan-card-${card.plan}-highlights`}>
              {card.lines.map((line) => (
                <li className="flex gap-2" key={line}>
                  <Check aria-hidden className="mt-0.5 shrink-0 text-primary" size={16} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </Tile>
      ))}
    </div>
  );
}
