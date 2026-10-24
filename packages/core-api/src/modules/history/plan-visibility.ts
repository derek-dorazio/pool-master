/**
 * What a squad page shows of a squad's rows on the league's plan (#948): pure functions over the
 * views HistoryService reads. A lower plan hides rows; it never deletes them, so the same read on
 * a higher plan shows them again (plans/monetization-strategy.md, *Moving to a lower plan*).
 */

import { PlanFeature, championshipYear } from '@poolmaster/shared/domain';
import type { SquadHistoryView, SquadYearView } from './service';

/** A squad's year without the rows the plan hides: its championship row without CHAMPIONSHIP, its cup rows without CUP_STANDINGS. */
export function squadYearInPlan(view: SquadYearView, features: ReadonlySet<PlanFeature>): SquadYearView {
  return {
    ...view,
    championship: features.has(PlanFeature.CHAMPIONSHIP) ? view.championship : null,
    cups: features.has(PlanFeature.CUP_STANDINGS) ? view.cups : [],
  };
}

/**
 * A squad's history without what the plan hides: its earlier years without PAST_YEARS, and each
 * year as `squadYearInPlan` leaves it. Its medals and trophies are the trophy shelf, which the
 * route itself requires.
 */
export function squadHistoryInPlan(view: SquadHistoryView, features: ReadonlySet<PlanFeature>, now: Date): SquadHistoryView {
  const currentYear = championshipYear(now);
  return {
    ...view,
    years: view.years
      .filter((year) => features.has(PlanFeature.PAST_YEARS) || year.year >= currentYear)
      .map((year) => squadYearInPlan(year, features)),
  };
}
