import { ContestStatus, PlanFeature, type CupWeight } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { setContestCupWeight, type ContestManagementDetailDto } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { CUP_WEIGHTS, CUP_WEIGHT_COPY } from '@/features/championships/cup-settings-view';
import { buildLeagueAdminContestPath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { ChoiceCard, ChoiceCardText, ErrorState, FormPage, FormSection, LoadingState, PendingPage } from '@/features/shared/ui';
import { useManagedContestQuery } from './use-managed-contest-query';

/**
 * How much one contest counts toward its sports league cup and the league championship. It can
 * change until the contest is final; a final contest's settings page shows the weight as fixed.
 */
export function EditContestCupWeightPage() {
  const { leagueCode = '', contestId = '' } = useParams<{ leagueCode: string; contestId: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league, viewer } = useLeagueContext(leagueCode);
  const hasCupSettings = hasPlanFeature(league, PlanFeature.CUP_SETTINGS);
  const managedContestQuery = useManagedContestQuery(hasCupSettings ? league?.id : undefined, contestId);
  const contestPath = buildLeagueAdminContestPath(leagueCode, contestId);

  if (!league) {
    return null;
  }
  if (!hasCupSettings) {
    return <PlanLockedNotice feature={PlanFeature.CUP_SETTINGS} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />;
  }
  if (managedContestQuery.isLoading) {
    return <PendingPage><LoadingState body="Loading contest..." /></PendingPage>;
  }
  if (managedContestQuery.isError || !managedContestQuery.data) {
    return <PendingPage><ErrorState body="We couldn't load this contest." onRetry={() => void managedContestQuery.refetch()} testId="edit-cup-weight-error" /></PendingPage>;
  }
  const contest = managedContestQuery.data;
  if (!league.isActive || contest.status === ContestStatus.COMPLETED) {
    return <Navigate replace to={contestPath} />;
  }

  // Keyed by the contest so a background refetch never overwrites the choice being made
  // (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
  return <CupWeightForm contest={contest} contestPath={contestPath} key={contest.id} leagueId={league.id} />;
}

function CupWeightForm({
  contest,
  contestPath,
  leagueId,
}: {
  contest: ContestManagementDetailDto;
  contestPath: string;
  leagueId: string;
}) {
  const navigate = useNavigate();
  const [cupWeight, setCupWeight] = useState<CupWeight>(contest.cupWeight);

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (weight: CupWeight) => {
      const response = await setContestCupWeight({
        path: { id: leagueId, contestId: contest.id },
        body: { cupWeight: weight },
      });
      if (!response.data?.contest) {
        throwApiError(response.error, 'Cup weight response is missing data.');
      }
      return response.data.contest;
    },
    onSuccess: () => navigate(contestPath),
    invalidates: [QueryKeys.managedContests.all, QueryKeys.cups.all],
  });

  return (
    <FormPage
      cancelTo={contestPath}
      errorMessage={saveMutation.isError
        ? extractErrorMessage(saveMutation.error, { fallback: 'We could not save the cup weight.' })
        : null}
      isPending={saveMutation.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        saveMutation.mutate(cupWeight);
      }}
      pendingLabel="Saving..."
      submitLabel="Save weight"
      submitTestId="edit-cup-weight-save"
      testId="edit-cup-weight-page"
      title="Cup weight"
    >
      <FormSection
        help={`How much ${contest.name} counts toward its sports league cup and the league championship. It is fixed once the contest is final.`}
        testId="edit-cup-weight-section"
        title="How much it counts"
      >
        <div aria-label="Cup weight" className="grid gap-2" role="radiogroup">
          {CUP_WEIGHTS.map((option) => (
            <ChoiceCard
              isDisabled={saveMutation.isPending}
              isSelected={option === cupWeight}
              key={option}
              onSelect={() => setCupWeight(option)}
              testId={`edit-cup-weight-${option}`}
            >
              <ChoiceCardText description={CUP_WEIGHT_COPY[option].description} label={CUP_WEIGHT_COPY[option].label} />
            </ChoiceCard>
          ))}
        </div>
      </FormSection>
    </FormPage>
  );
}
