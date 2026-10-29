import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  LEAGUE_PLANS,
  LeaguePlan,
  PLAN_FEATURE_GROUP,
  PlanCap,
  PlanFeature,
  PlanFeatureGroup,
} from '@poolmaster/shared/domain';
import { updateSettingsGroup, type SettingsGroup } from '@/lib/api';
import {
  Alert,
  AsyncPage,
  Button,
  Checkbox,
  DateDisplay,
  Input,
  Select,
  SettingsSectionHeader,
  Tile,
} from '@/features/shared/ui';
import {
  LEAGUE_PLAN_LABEL,
  PLAN_CAP_LABEL,
  PLAN_FEATURE_GROUP_LABEL,
  PLAN_FEATURE_LABEL,
  formatPlanLimit,
} from '@/features/plans/plan-labels';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { extractErrorMessage, hasErrorCode, throwApiError } from '@/lib/errors';
import { ManagePageIntro } from './manage-page-intro';
import { useSettingsGroupsQuery } from './use-settings-groups';
import {
  PlanSettingsDraftSchema,
  toPlanConfig,
  toPlanSettingsDraft,
  type PlanSettingsDraft,
} from './plan-settings-draft';

type PlanSettingsGroup = Extract<SettingsGroup, { key: 'PLAN_CONFIG' }>;

/** What every league has whatever its plan, listed in its group so the admin sees it is not missing. */
const ALWAYS_INCLUDED: Readonly<Record<PlanFeatureGroup, readonly string[]>> = {
  [PlanFeatureGroup.EMAILS]: ['Account, security and membership emails'],
  [PlanFeatureGroup.CHAMPIONSHIPS]: [],
  [PlanFeatureGroup.HISTORY]: ['Contest results and places, and the Contests page History view'],
};

/** A feature dropdown's choices: the plan it starts at, and the plans above it that have it too. */
const FEATURE_STARTS_AT_LABEL: Readonly<Record<LeaguePlan, string>> = {
  [LeaguePlan.FREE]: 'Every plan',
  [LeaguePlan.PRO]: 'Pro and up',
  [LeaguePlan.PREMIUM]: 'Premium and up',
  [LeaguePlan.PLATINUM]: 'Platinum only',
};

const tableHeaderClassName = 'bg-[var(--table-header-surface)] text-xs uppercase text-muted-foreground';

function isPlanSettingsGroup(group: SettingsGroup): group is PlanSettingsGroup {
  return group.key === 'PLAN_CONFIG';
}

/**
 * /manage/plans (#946): what each league plan allows, saved as the PLAN_CONFIG settings group, so
 * a save lands in the settings history and reaches every server within the settings refresh.
 */
export function RootAdminPlansPage() {
  const settingsQuery = useSettingsGroupsQuery();
  // poolmaster-allow-list-lookup: the handful of settings groups, already loaded for the settings screens
  const group = settingsQuery.data?.find(isPlanSettingsGroup);

  // A settings list without PLAN_CONFIG is an error, not a page still loading.
  const pageState = settingsQuery.isError || (settingsQuery.data && !group) ? 'error' : settingsQuery.isLoading ? 'loading' : 'ready';

  return (
    <AsyncPage
      errorBody={extractErrorMessage(settingsQuery.error, { fallback: 'We could not load the plans right now.' })}
      loadingBody="Loading plans..."
      state={pageState}
      testId="root-admin-plans-page"
    >
      <ManagePageIntro>
        What each league plan allows, from Free up to Platinum. A higher plan always allows at least
        as much as the one below it, and Platinum has every feature. Commissioners can&apos;t pick
        Platinum yet: they see it as coming soon. A saved change reaches every server within 30
        seconds.
      </ManagePageIntro>
      {group ? <PlanSettingsForm group={group} /> : null}
    </AsyncPage>
  );
}

/**
 * The caps grid and the feature list, saved together. The draft is taken from the group once,
 * like the Settings page forms, and a 409 offers to load the newer value.
 */
function PlanSettingsForm({ group }: { group: PlanSettingsGroup }) {
  const queryClient = useQueryClient();
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(group.updatedAt);
  const [lastChange, setLastChange] = useState({ at: group.updatedAt, by: group.updatedBy });
  const form = useForm<PlanSettingsDraft>({
    resolver: zodResolver(PlanSettingsDraftSchema),
    defaultValues: toPlanSettingsDraft(group.value),
  });

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (draft: PlanSettingsDraft) => {
      const response = await updateSettingsGroup({
        path: { key: 'PLAN_CONFIG' },
        body: { key: 'PLAN_CONFIG', value: toPlanConfig(draft), expectedUpdatedAt: baseUpdatedAt },
      });
      if (response.data?.key !== 'PLAN_CONFIG') {
        throwApiError(response.error, 'Plans settings response is missing data.');
      }
      return response.data;
    },
    onSuccess: (saved) => {
      setBaseUpdatedAt(saved.updatedAt);
      setLastChange({ at: saved.updatedAt, by: saved.updatedBy });
      form.reset(toPlanSettingsDraft(saved.value));
    },
    invalidates: [QueryKeys.rootAdmin.settings],
  });

  const conflicted = hasErrorCode(saveMutation.error, 'SETTINGS_CONFLICT');

  async function loadLatest() {
    await queryClient.refetchQueries({ queryKey: QueryKeys.rootAdmin.settings, exact: true });
    const latest = queryClient
      .getQueryData<SettingsGroup[]>(QueryKeys.rootAdmin.settings)
      ?.find(isPlanSettingsGroup);
    if (!latest) {
      return;
    }
    setBaseUpdatedAt(latest.updatedAt);
    setLastChange({ at: latest.updatedAt, by: latest.updatedBy });
    form.reset(toPlanSettingsDraft(latest.value));
    saveMutation.reset();
  }

  return (
    <form
      className="space-y-8"
      data-testid="root-admin-plans-form"
      noValidate
      onSubmit={(event) => void form.handleSubmit((draft) => saveMutation.mutate(draft))(event)}
    >
      <CapsGrid form={form} />
      <FeatureList form={form} />
      {saveMutation.isError ? (
        <Alert
          action={conflicted ? (
            <Button onClick={() => void loadLatest()} type="button" variant="secondary">
              Load the latest plans
            </Button>
          ) : undefined}
          data-testid="root-admin-plans-error"
          tone="danger"
        >
          {extractErrorMessage(saveMutation.error, { fallback: 'We could not save the plans.' })}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="root-admin-plans-save" disabled={saveMutation.isPending} type="submit">
          {saveMutation.isPending ? 'Saving...' : 'Save plans'}
        </Button>
        <p className="text-sm text-muted-foreground" data-testid="root-admin-plans-last-change">
          {lastChange.at ? (
            <>
              Last changed by {lastChange.by?.name ?? 'an unknown admin'} on <DateDisplay value={lastChange.at} />.
              Recent changes are listed on Settings.
            </>
          ) : 'Never changed: using the starting values.'}
        </p>
      </div>
    </form>
  );
}

function CapsGrid({ form }: { form: UseFormReturn<PlanSettingsDraft> }) {
  const { errors } = form.formState;
  const caps = form.watch('caps');

  return (
    <section className="space-y-3">
      <SettingsSectionHeader
        description="The most each plan allows. Entries per contest counts drafts; sports leagues a year counts the different sports leagues of the league's contests this calendar year."
        title="Caps"
      />
      <Tile className="overflow-x-auto" data-testid="root-admin-plans-caps" padding="none" radius="md">
        <table className="min-w-full text-left text-sm">
          <thead className={tableHeaderClassName}>
            <tr>
              <th className="px-4 py-2" scope="col">Cap</th>
              {LEAGUE_PLANS.map((plan) => (
                <th className="px-4 py-2" key={plan} scope="col">{LEAGUE_PLAN_LABEL[plan]}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Object.values(PlanCap).map((cap) => (
              <tr data-testid={`root-admin-plans-cap-${cap}`} key={cap}>
                <th className="px-4 py-3 align-top font-medium text-foreground" scope="row">{PLAN_CAP_LABEL[cap]}</th>
                {LEAGUE_PLANS.map((plan) => {
                  const cellName = `${PLAN_CAP_LABEL[cap]} on ${LEAGUE_PLAN_LABEL[plan]}`;
                  const error = errors.caps?.[cap]?.[plan]?.limit?.message;
                  const errorId = `root-admin-plans-${cap}-${plan}-error`;
                  return (
                    <td className="min-w-40 px-4 py-3 align-top" key={plan}>
                      <div className="space-y-2">
                        {caps[cap][plan].unlimited ? (
                          <p className="py-2 text-foreground">{formatPlanLimit(null)}</p>
                        ) : (
                          <Input
                            aria-describedby={error ? errorId : undefined}
                            aria-invalid={Boolean(error) || undefined}
                            aria-label={cellName}
                            data-testid={`root-admin-plans-${cap}-${plan}-limit`}
                            inputMode="numeric"
                            {...form.register(`caps.${cap}.${plan}.limit`)}
                          />
                        )}
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Checkbox
                            aria-label={`${cellName}: Unlimited`}
                            data-testid={`root-admin-plans-${cap}-${plan}-unlimited`}
                            {...form.register(`caps.${cap}.${plan}.unlimited`)}
                          />
                          Unlimited
                        </label>
                        {error ? <p className="text-sm text-destructive" id={errorId}>{error}</p> : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Tile>
    </section>
  );
}

function FeatureList({ form }: { form: UseFormReturn<PlanSettingsDraft> }) {
  return (
    <section className="space-y-3">
      <SettingsSectionHeader
        description="The first plan that has each feature; every plan above it has it too."
        title="Features"
      />
      {Object.values(PlanFeatureGroup).map((featureGroup) => (
        <Tile data-testid={`root-admin-plans-features-${featureGroup}`} key={featureGroup} padding="none" radius="xl">
          <h3 className="title-card px-4 pt-4 text-sm text-foreground">{PLAN_FEATURE_GROUP_LABEL[featureGroup]}</h3>
          <ul className="divide-y divide-border">
            {ALWAYS_INCLUDED[featureGroup].map((label) => (
              <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm" key={label}>
                <span className="text-foreground">{label}</span>
                <span className="text-muted-foreground">Always</span>
              </li>
            ))}
            {Object.values(PlanFeature).filter((feature) => PLAN_FEATURE_GROUP[feature] === featureGroup).map((feature) => (
              <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm" key={feature}>
                <span className="text-foreground">{PLAN_FEATURE_LABEL[feature]}</span>
                <Select
                  aria-label={`${PLAN_FEATURE_LABEL[feature]} starts at`}
                  className="w-40"
                  data-testid={`root-admin-plans-feature-${feature}`}
                  {...form.register(`features.${feature}`)}
                >
                  {LEAGUE_PLANS.map((plan) => (
                    <option key={plan} value={plan}>
                      {FEATURE_STARTS_AT_LABEL[plan]}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        </Tile>
      ))}
    </section>
  );
}
