import { useMemo, useState } from 'react';
import { LEAGUE_PLANS, type PlanCap, type PlanFeature } from '@poolmaster/shared/domain';
import {
  DataGrid,
  DateDisplay,
  HelpTip,
  PageHeader,
  QueryState,
  SectionCard,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { plural } from '@/lib/plural';
import { extractErrorMessage } from '@/lib/errors';
import { PlanCapDialog } from './plan-cap-dialog';
import { planCapColumns, planFeatureColumns } from './plan-columns';
import { PlanFeatureDialog } from './plan-feature-dialog';
import type { PlanSettingsGroup } from './plan-row-dialog';
import { planCapRows, planFeatureRows } from './plan-rows';
import { useSettingsGroupQuery } from './use-settings-groups';

/**
 * /manage/plans (#1884): what each league plan allows, as two grids edited a row at a time. Plans
 * are one PLAN_CONFIG settings record, so each row's Save sends the whole record with only that
 * row changed, lands in the settings history, and reaches every server within the settings
 * refresh. Plan names and order stay in code.
 */
export function RootAdminPlansPage() {
  const settingsQuery = useSettingsGroupQuery('PLAN_CONFIG');
  const group = settingsQuery.data;

  return (
    <section className="space-y-6" data-testid="root-admin-plans-page">
      <PageHeader
        meta={group ? <LastChangeLine group={group} /> : undefined}
        testId="root-admin-plans-header"
        title="Plans"
        titleAside={(
          <HelpTip label="About plans" testId="root-admin-plans-help">
            What each league plan allows, from Free up to Platinum. A higher plan always allows at
            least as much as the one below it, and Platinum has every feature. Commissioners
            can&apos;t pick Platinum yet: they see it as coming soon. A saved change reaches every
            server within 30 seconds.
          </HelpTip>
        )}
      />
      <QueryState
        error={extractErrorMessage(settingsQuery.error, { fallback: 'We could not load the plans right now.' })}
        loading="Loading plans..."
        query={settingsQuery}
        size="tile"
        testId="root-admin-plans"
      >
        {(loaded) => (
          <>
            <CapsSection group={loaded} />
            <FeaturesSection group={loaded} />
          </>
        )}
      </QueryState>
    </section>
  );
}

/** "4 plans · Last changed by Ada on Oct 24, 2026": once for the record, since every row saves it. */
function LastChangeLine({ group }: { group: PlanSettingsGroup }) {
  return (
    <span data-testid="root-admin-plans-last-change">
      {plural(LEAGUE_PLANS.length, 'plan')}
      {' · '}
      {group.updatedAt
        ? <>Last changed by {group.updatedBy?.name ?? 'an unknown admin'} on <DateDisplay timeStyle={null} value={group.updatedAt} /></>
        : 'Never changed: on the starting values'}
    </span>
  );
}

function CapsSection({ group }: { group: PlanSettingsGroup }) {
  const { locale } = useDisplayPreferences();
  const [openCap, setOpenCap] = useState<PlanCap | null>(null);
  const rows = useMemo(() => planCapRows(group.value), [group.value]);
  const columns = useMemo(() => planCapColumns(locale), [locale]);
  const openRow = rows.find((row) => row.cap === openCap);

  return (
    <SectionCard
      help="The most each plan allows. Entries per contest counts drafts; sports leagues a year counts the different sports leagues of the league's contests this calendar year."
      padded
      testId="root-admin-plans-caps"
      title="Caps"
    >
      <DataGrid
        columns={columns}
        data={rows}
        emptyMessage="No caps."
        filterTestIdPrefix="root-admin-plans-caps-filter"
        getRowId={(row) => row.cap}
        openRowDialog={(row) => setOpenCap(row.cap)}
        rowTestId={(row) => `root-admin-plans-cap-${row.cap}`}
        tableTestId="root-admin-plans-caps-table"
        urlKey="caps"
      />
      {openRow ? <PlanCapDialog group={group} key={openRow.cap} onClose={() => setOpenCap(null)} row={openRow} /> : null}
    </SectionCard>
  );
}

function FeaturesSection({ group }: { group: PlanSettingsGroup }) {
  const [openFeature, setOpenFeature] = useState<PlanFeature | null>(null);
  const rows = useMemo(() => planFeatureRows(group.value), [group.value]);
  const openRow = rows.find((row) => row.feature === openFeature);

  return (
    <SectionCard
      help="The first plan that has each feature; every plan above it has it too. Account, security and membership emails, and contest results and history, come with every plan, so they are not listed."
      padded
      testId="root-admin-plans-features"
      title="Features"
    >
      <DataGrid
        columns={planFeatureColumns}
        data={rows}
        emptyMessage="No features."
        filterTestIdPrefix="root-admin-plans-features-filter"
        getRowId={(row) => row.feature}
        openRowDialog={(row) => setOpenFeature(row.feature)}
        rowTestId={(row) => `root-admin-plans-feature-${row.feature}`}
        tableTestId="root-admin-plans-features-table"
        urlKey="features"
      />
      {openRow ? <PlanFeatureDialog group={group} key={openRow.feature} onClose={() => setOpenFeature(null)} row={openRow} /> : null}
    </SectionCard>
  );
}
