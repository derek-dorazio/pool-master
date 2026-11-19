import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { LEAGUE_PLANS } from '@poolmaster/shared/domain';
import { extendLeaguePlanRenewal, updateLeaguePlan, type CustomerLeagueDto } from '@/lib/api';
import { formatUserName } from '@/features/account/user-name';
import { buildLeaguePath } from '@/features/leagues/league-routing';
import { LEAGUE_PLAN_LABEL } from '@/features/plans/plan-labels';
import { DateDisplay, DetailEditModal, FormField, LinkButton, Select, showToast } from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { refreshAfterWrite, useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { PREVIEW_EXTEND_MONTHS, previewExtendMonthsLabel } from '@/features/plans/preview-extend-months';
import {
  customerLeagueChange,
  customerLeagueFormSchema,
  customerLeagueFormValues,
  type CustomerLeagueChange,
  type CustomerLeagueFormValues,
} from './customer-league-edit';
import { PartialSaveError, runSaveSteps, type SaveStep } from './save-steps';

/**
 * One league on Customers › Leagues (#1883): its Details, an Actions section that opens the league
 * itself, and Close and Edit. Edit changes the plan and moves the Premium preview's end, then comes
 * back to the view (rules/ux-rules.md §12 item 14).
 */
export function CustomerLeagueDialog({ league, onClose }: { league: CustomerLeagueDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const testId = 'root-admin-customer-league-dialog';
  const form = useForm<CustomerLeagueFormValues>({
    resolver: zodResolver(customerLeagueFormSchema),
    defaultValues: customerLeagueFormValues(league),
    mode: 'onChange',
  });

  const saveMutation = useInvalidatingMutation({
    mutationFn: ({ extendMonths, plan }: CustomerLeagueChange) => {
      const steps: SaveStep[] = [];
      if (plan !== null) {
        steps.push({ what: 'plan', run: async () => {
          const response = await updateLeaguePlan({ path: { id: league.id }, body: { plan } });
          if (!response.data) throwApiError(response.error, 'Plan change response is missing data.');
        } });
      }
      if (extendMonths !== null) {
        steps.push({ what: 'preview end', run: async () => {
          const response = await extendLeaguePlanRenewal({ path: { id: league.id }, body: { months: extendMonths } });
          if (!response.data) throwApiError(response.error, 'Preview extension response is missing data.');
        } });
      }
      return runSaveSteps(steps);
    },
    // A half-applied save still changed the league, so the grid reads it again.
    onError: (error) => {
      if (error instanceof PartialSaveError) void refreshAfterWrite(queryClient, [QueryKeys.rootAdmin.manageLeagues, QueryKeys.leagues.all]);
    },
    onSuccess: () => {
      showToast({ title: `Saved ${league.name}`, tone: 'success' });
      setMode('view');
    },
    invalidates: [QueryKeys.rootAdmin.manageLeagues, QueryKeys.leagues.all],
  });

  const cancelEdit = () => {
    form.reset(customerLeagueFormValues(league));
    saveMutation.reset();
    setMode('view');
  };

  return (
    <DetailEditModal
      actions={[{
        id: 'open-league',
        name: 'Open league',
        description: 'Goes to the league itself, as root admin.',
        control: (
          <LinkButton data-testid={`${testId}-open-league`} size="sm" to={buildLeaguePath(league.leagueCode)} variant="secondary">
            Open league ›
          </LinkButton>
        ),
        testId: `${testId}-action-open-league`,
      }]}
      canSave={form.formState.isValid && form.formState.isDirty}
      error={saveMutation.error}
      errorFallback="We could not save this league."
      facts={[
        { id: 'code', label: 'Code', value: league.leagueCode, testId: `${testId}-code` },
        { id: 'plan', label: 'Plan', value: LEAGUE_PLAN_LABEL[league.plan], testId: `${testId}-plan` },
        {
          id: 'owner',
          label: 'Owner',
          value: league.owner === null ? 'No active commissioner' : formatUserName(league.owner.firstName, league.owner.lastName),
          testId: `${testId}-owner`,
        },
        { id: 'members', label: 'Members', value: league.memberCount, testId: `${testId}-members` },
        { id: 'active-contests', label: 'Active contests', value: league.activeContestCount, testId: `${testId}-active-contests` },
        {
          id: 'preview',
          label: 'Premium preview',
          value: league.previewEndsAt === null ? 'None' : <>Ends <DateDisplay timeStyle={null} value={league.previewEndsAt} /></>,
          testId: `${testId}-preview`,
        },
      ]}
      isPending={saveMutation.isPending}
      mode={mode}
      onCancel={onClose}
      onCancelEdit={cancelEdit}
      onEdit={() => {
        form.reset(customerLeagueFormValues(league));
        setMode('edit');
      }}
      onOpenChange={(open) => (open ? undefined : onClose())}
      onSave={() => void form.handleSubmit((values) => saveMutation.mutate(customerLeagueChange(league, values)))()}
      open
      pendingLabel="Saving..."
      saveLabel="Save"
      testId={testId}
      title={mode === 'view' ? league.name : `${league.name} · Edit`}
    >
      <div className="grid gap-4">
        <FormField label="Plan">
          <Select data-testid={`${testId}-plan-input`} {...form.register('plan')}>
            {LEAGUE_PLANS.map((plan) => <option key={plan} value={plan}>{LEAGUE_PLAN_LABEL[plan]}</option>)}
          </Select>
        </FormField>
        <FormField help="Moves the end of the free Premium preview to the months picked from today. An end already later stays as it is." label="Premium preview ends">
          <Select data-testid={`${testId}-extend-input`} {...form.register('extendMonths')}>
            <option value="">Keep as it is</option>
            {PREVIEW_EXTEND_MONTHS.map((months) => (
              <option key={months} value={String(months)}>
                {previewExtendMonthsLabel(months)}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
    </DetailEditModal>
  );
}
