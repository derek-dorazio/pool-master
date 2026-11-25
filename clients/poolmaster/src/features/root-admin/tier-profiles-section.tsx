import { enumLabel } from '@poolmaster/shared/display-strings';
import { createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';
import { TierProfileType, TierProfileTypeOrder } from '@poolmaster/shared/domain';
import { deletePlatformTierProfile, type PlatformTierProfileDto } from '@/lib/api';
import { Button, DataGrid, QueryState, RowActionsMenu, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { ProfileDeleteDialog } from './profile-delete-dialog';
import { ProfileDialog, type ProfileDialogState } from './profile-dialog';
import { PlatformTierProfileEditor } from './tier-profile-editor';
import { describeLastTier, describeRanges, describeSources, describeTierLayout } from './tier-profile-format';
import { usePlatformTierProfilesQuery } from './use-profiles';

const columnHelper = createColumnHelper<PlatformTierProfileDto>();

const columns = [
  columnHelper.accessor('code', {
    header: 'Code',
    meta: { info: 'The tier profile\'s key: what migrations, seed scripts and test data find it by.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('name', {
    header: 'Name',
    meta: { info: 'The tier profile\'s name, as a sport league\'s settings offer it.', type: { kind: 'text' } },
  }),
  columnHelper.accessor((profile) => describeSources(profile.sources), {
    id: 'sources',
    header: 'Order by',
    meta: { info: 'The values auto-tiering puts the field in order by: the first everyone has decides, and later ones break ties.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('type', {
    header: 'Tiers by',
    meta: {
      info: 'Equal groups: tiers of one size in the field\'s order. Ranges: each tier takes the seeds or ranks its range holds.',
      type: { kind: 'enum', order: TierProfileTypeOrder, label: (value) => enumLabel('TierProfileType', value as TierProfileType) },
    },
  }),
  columnHelper.accessor((profile) => describeTierLayout(profile), {
    id: 'layout',
    header: 'Layout',
    meta: { info: 'Equal groups: how many tiers, how many in each, and what the last takes (capped: anyone beyond is in no tier and can\'t be picked). Ranges: each tier\'s seeds or ranks, first to last.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('sportLeagueCount', {
    header: 'Used by',
    meta: { info: 'How many sport leagues name it. A profile any league uses can\'t be deleted.', type: { kind: 'number' } },
  }),
];

/**
 * The Profiles page's tier profiles (#1849): one grid, a row opening its dialog (see it, then
 * Edit), New for another, and Delete in each row's menu, which the server refuses while a sport
 * league names the profile.
 */
export function PlatformTierProfilesSection() {
  const profilesQuery = usePlatformTierProfilesQuery();
  const [dialog, setDialog] = useState<ProfileDialogState<PlatformTierProfileDto>>(null);
  const [deleting, setDeleting] = useState<PlatformTierProfileDto | null>(null);

  return (
    <SectionCard
      padded
      testId="root-admin-tier-profiles"
      title="Tier profiles"
      trailing={(
        <Button data-testid="root-admin-tier-profiles-new" onClick={() => setDialog({ mode: 'new' })} size="sm" variant="secondary">
          New
        </Button>
      )}
    >
      <QueryState
        error={extractErrorMessage(profilesQuery.error, { fallback: 'We could not load the tier profiles right now.' })}
        loading="Loading tier profiles..."
        query={profilesQuery}
        testId="root-admin-tier-profiles-state"
      >
        {(profiles) => (
          <DataGrid
            columns={columns}
            data={profiles}
            emptyMessage="No tier profiles yet."
            filterTestIdPrefix="root-admin-tier-profiles-filter"
            getRowId={(profile) => profile.id}
            openRowDialog={(profile) => setDialog({ mode: 'view', profile })}
            rowActions={(profile) => (
              <RowActionsMenu
                actions={[{ label: 'Delete', onSelect: () => setDeleting(profile), testId: `root-admin-tier-profile-${profile.id}-delete`, tone: 'danger' }]}
                label={`Actions for ${profile.name}`}
                testId={`root-admin-tier-profile-${profile.id}-actions`}
              />
            )}
            rowTestId={(profile) => `root-admin-tier-profile-${profile.id}`}
            tableTestId="root-admin-tier-profiles-table"
            urlKey="platformTierProfiles"
          />
        )}
      </QueryState>
      <ProfileDialog
        facts={(profile) => [
          { id: 'sources', label: 'Order by', value: describeSources(profile.sources) },
          { id: 'type', label: 'Tiers by', value: enumLabel('TierProfileType', profile.type) },
          ...(profile.type === TierProfileType.RANGES
            ? [{ id: 'ranges', label: 'Ranges', value: describeRanges(profile.ranges) }]
            : [
              { id: 'tiers', label: 'Tiers', value: profile.tierCount },
              { id: 'per-tier', label: 'Per tier', value: profile.tierSize },
              { id: 'last-tier', label: 'Last tier', value: describeLastTier(profile) },
            ]),
          { id: 'used-by', label: 'Used by', value: profile.sportLeagueCount },
        ]}
        // poolmaster-allow-list-lookup: tier profiles are reference data, a handful of rows
        liveProfile={(id) => profilesQuery.data?.find((profile) => profile.id === id)}
        names={(league, profile) => league.platformTierProfileId === profile.id}
        onStateChange={setDialog}
        renderEditor={(props) => <PlatformTierProfileEditor {...props} />}
        state={dialog}
        testId="root-admin-tier-profile-dialog"
      />
      {deleting ? (
        <ProfileDeleteDialog
          invalidates={QueryKeys.rootAdmin.platformTierProfiles}
          kindLabel="tier profile"
          name={deleting.name}
          onClose={() => setDeleting(null)}
          remove={async () => {
            const response = await deletePlatformTierProfile({ path: { profileId: deleting.id } });
            if (response.error) throwApiError(response.error, 'Tier profile delete failed.');
          }}
          testId="root-admin-tier-profile-delete"
        />
      ) : null}
    </SectionCard>
  );
}
