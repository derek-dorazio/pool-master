/**
 * The error a write the league's plan does not allow throws (#948). Routes send it as 403
 * PLAN_FEATURE_NOT_INCLUDED with the feature in `details` (`sendPlanFeatureNotIncluded`).
 */

import type { PlanFeature } from '@poolmaster/shared/domain';

/** A write the league's plan does not allow, such as switching the Hall of Lame without the record book. */
export class PlanFeatureNotIncludedError extends Error {
  readonly code = 'PLAN_FEATURE_NOT_INCLUDED';

  constructor(readonly feature: PlanFeature) {
    super('This league\'s plan does not include this.');
    this.name = 'PlanFeatureNotIncludedError';
  }
}
