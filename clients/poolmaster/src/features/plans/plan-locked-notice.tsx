import type { PlanFeature } from '@poolmaster/shared/domain';
import { buildLeagueAdminPlanEditPath } from '@/features/leagues/league-routing';
import { EmptyState, LinkButton } from '@/features/shared/ui';
import { PLAN_FEATURE_LABEL } from './plan-labels';

/**
 * What a view the league's plan lacks shows instead (#948): its name and a short note. Only a
 * commissioner learns it is the plan and where to change it; a member never sees a plan named.
 * Nothing behind it is deleted, so a higher plan shows it again as it stands.
 */
export function PlanLockedNotice({
  feature,
  isCommissioner,
  leagueCode,
  title = PLAN_FEATURE_LABEL[feature],
}: {
  feature: PlanFeature;
  isCommissioner: boolean;
  leagueCode: string;
  /** The page's own name, when it stands for more than its feature. */
  title?: string;
}) {
  return (
    <EmptyState
      action={isCommissioner ? (
        <LinkButton data-testid={`plan-locked-${feature}-change`} size="sm" to={buildLeagueAdminPlanEditPath(leagueCode)} variant="secondary">
          Change plan
        </LinkButton>
      ) : undefined}
      body={isCommissioner
        ? 'Your league\'s plan doesn\'t include this. On a plan that does, it shows again with everything recorded meanwhile.'
        : 'This isn\'t turned on for this league.'}
      testId={`plan-locked-${feature}`}
      title={title}
    />
  );
}
