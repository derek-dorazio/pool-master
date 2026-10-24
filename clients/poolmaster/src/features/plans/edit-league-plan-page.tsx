import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { LEAGUE_PLANS, type LeaguePlan } from '@poolmaster/shared/domain';
import { updateLeaguePlan, type LeagueDto } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { syncLeagueCaches } from '@/features/leagues/league-cache';
import { buildLeagueAdminPath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { ChoiceCard, FormPage } from '@/features/shared/ui';
import { PlanComparisonTable } from './plan-comparison-table';
import { LEAGUE_PLAN_LABEL } from './plan-labels';
import { useLeaguePlansQuery } from './use-league-plans-query';

/**
 * Choose a plan (#945): any commissioner, or a root admin, moves the league to any plan, free,
 * and it applies at once. The comparison table shows what each plan includes.
 */
export function EditLeaguePlanPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { league } = useLeagueContext(leagueCode);

  // The guard above this page has already loaded the league context.
  if (!league) {
    return null;
  }
  // An inactive league is read-only; its settings page says why Change is unavailable.
  if (!league.isActive) {
    return <Navigate replace to={buildLeagueAdminPath(league.leagueCode)} />;
  }

  // Keyed by the league so a background refetch never overwrites the choice
  // (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
  return <LeaguePlanForm key={league.id} league={league} />;
}

function LeaguePlanForm({ league }: { league: LeagueDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settingsPath = buildLeagueAdminPath(league.leagueCode);
  const plansQuery = useLeaguePlansQuery();
  const [plan, setPlan] = useState<LeaguePlan>(league.planEntitlements.plan);

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (chosen: LeaguePlan) => {
      const response = await updateLeaguePlan({ path: { id: league.id }, body: { plan: chosen } });
      if (!response.data?.league) {
        throwApiError(response.error, 'Plan change response is missing data.');
      }
      return response.data.league;
    },
    onSuccess: (updated) => {
      syncLeagueCaches(queryClient, updated);
      navigate(settingsPath);
    },
    // Root admin's league list shows each league's plan.
    invalidates: [QueryKeys.rootAdmin.manageLeagues],
  });

  return (
    <FormPage
      cancelTo={settingsPath}
      description="Every plan is free for now. A change applies at once. Members never see which plan the league is on."
      errorMessage={saveMutation.isError
        ? extractErrorMessage(saveMutation.error, { fallback: 'We could not change the plan.' })
        : null}
      isPending={saveMutation.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        saveMutation.mutate(plan);
      }}
      pendingLabel="Saving..."
      submitLabel="Save plan"
      submitTestId="edit-plan-save"
      testId="edit-plan-page"
      title="Choose a plan"
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Plan</legend>
        <div aria-label="Plan" className="grid gap-2 sm:grid-cols-2" role="radiogroup">
          {LEAGUE_PLANS.map((option) => (
            <ChoiceCard
              isDisabled={saveMutation.isPending}
              isSelected={option === plan}
              key={option}
              onSelect={() => setPlan(option)}
              testId={`edit-plan-option-${option}`}
            >
              <span className="font-semibold">{LEAGUE_PLAN_LABEL[option]}</span>
            </ChoiceCard>
          ))}
        </div>
      </fieldset>

      <p className="text-xs text-muted-foreground" data-testid="edit-plan-lower-note">
        A lower plan stops new entries and sports leagues past its limits, but never removes
        anything already made. Features it does not include are hidden, not deleted, and come back
        on a higher plan.
      </p>

      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground">Compare plans</div>
        {plansQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading plans...</p>
        ) : plansQuery.isError || !plansQuery.data ? (
          <p className="text-sm text-muted-foreground" role="alert">We couldn&apos;t load the plans.</p>
        ) : (
          <PlanComparisonTable plans={plansQuery.data} />
        )}
      </div>
    </FormPage>
  );
}
