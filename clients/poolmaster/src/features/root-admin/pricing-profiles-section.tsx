import { createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';
import { formatDollars } from '@poolmaster/shared/domain';
import { deletePlatformPricingProfile, type PlatformPricingProfileDto } from '@/lib/api';
import { Button, DataGrid, QueryState, RowActionsMenu, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { PlatformPricingProfileEditor } from './pricing-profile-editor';
import { ProfileDeleteDialog } from './profile-delete-dialog';
import { ProfileDialog, type ProfileDialogState } from './profile-dialog';
import { usePlatformPricingProfilesQuery } from './use-profiles';
import { describeSources } from './tier-profile-format';

const columnHelper = createColumnHelper<PlatformPricingProfileDto>();

const columns = [
  columnHelper.accessor('code', {
    header: 'Code',
    meta: { info: 'The pricing profile\'s key: what migrations, seed scripts and test data find it by.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('name', {
    header: 'Name',
    meta: { info: 'The pricing profile\'s name, as a sport league\'s settings and the price dialog offer it.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('salaryCap', {
    header: 'Salary cap',
    meta: { info: 'Whole dollars: the cap every budget contest on an event has, which prices are a share of.', type: { kind: 'number' } },
    cell: ({ getValue }) => formatDollars(getValue()),
  }),
  columnHelper.accessor('unit', {
    header: 'Unit',
    meta: { info: 'Whole dollars: every price is rounded to a multiple of it.', type: { kind: 'number' } },
    cell: ({ getValue }) => formatDollars(getValue()),
  }),
  columnHelper.accessor('topSharePercent', {
    header: 'Top share %',
    meta: { info: 'The best participant\'s price, as a percentage of the salary cap.', type: { kind: 'number' } },
  }),
  columnHelper.accessor('floorSharePercent', {
    header: 'Floor share %',
    meta: { info: 'The worst participant\'s price, as a percentage of the salary cap. At most the top share.', type: { kind: 'number' } },
  }),
  columnHelper.accessor('steepness', {
    header: 'Steepness',
    meta: { info: 'How fast prices fall from the top: 1 is a straight line; higher keeps the top few expensive.', type: { kind: 'number' } },
  }),
  columnHelper.accessor((profile) => describeSources(profile.sources), {
    id: 'sources',
    header: 'Order by',
    meta: { info: 'The values pricing puts the field in order by: the first everyone has decides, and later ones break ties. A league\'s tier and pricing profiles start with the same one.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('sportLeagueCount', {
    header: 'Used by',
    meta: { info: 'How many sport leagues name it. A profile any league uses can\'t be deleted.', type: { kind: 'number' } },
  }),
];

/**
 * The Profiles page's pricing profiles (#1849), which replace the old Budget pricing settings:
 * one grid, a row opening its dialog (see it, then Edit), New for another, and Delete in each
 * row's menu, which the server refuses while a sport league names the profile.
 */
export function PlatformPricingProfilesSection() {
  const profilesQuery = usePlatformPricingProfilesQuery();
  const [dialog, setDialog] = useState<ProfileDialogState<PlatformPricingProfileDto>>(null);
  const [deleting, setDeleting] = useState<PlatformPricingProfileDto | null>(null);

  return (
    <SectionCard
      padded
      testId="root-admin-pricing-profiles"
      title="Pricing profiles"
      trailing={(
        <Button data-testid="root-admin-pricing-profiles-new" onClick={() => setDialog({ mode: 'new' })} size="sm" variant="secondary">
          New
        </Button>
      )}
    >
      <QueryState
        error={extractErrorMessage(profilesQuery.error, { fallback: 'We could not load the pricing profiles right now.' })}
        loading="Loading pricing profiles..."
        query={profilesQuery}
        testId="root-admin-pricing-profiles-state"
      >
        {(profiles) => (
          <DataGrid
            columns={columns}
            data={profiles}
            emptyMessage="No pricing profiles yet."
            filterTestIdPrefix="root-admin-pricing-profiles-filter"
            getRowId={(profile) => profile.id}
            openRowDialog={(profile) => setDialog({ mode: 'view', profile })}
            rowActions={(profile) => (
              <RowActionsMenu
                actions={[{ label: 'Delete', onSelect: () => setDeleting(profile), testId: `root-admin-pricing-profile-${profile.id}-delete`, tone: 'danger' }]}
                label={`Actions for ${profile.name}`}
                testId={`root-admin-pricing-profile-${profile.id}-actions`}
              />
            )}
            rowTestId={(profile) => `root-admin-pricing-profile-${profile.id}`}
            tableTestId="root-admin-pricing-profiles-table"
            urlKey="platformPricingProfiles"
          />
        )}
      </QueryState>
      <ProfileDialog
        facts={(profile) => [
          { id: 'sources', label: 'Order by', value: describeSources(profile.sources) },
          { id: 'salary-cap', label: 'Salary cap', value: formatDollars(profile.salaryCap) },
          { id: 'unit', label: 'Unit', value: formatDollars(profile.unit) },
          { id: 'top-share', label: 'Top share', value: `${profile.topSharePercent}%` },
          { id: 'floor-share', label: 'Floor share', value: `${profile.floorSharePercent}%` },
          { id: 'steepness', label: 'Steepness', value: profile.steepness },
          { id: 'used-by', label: 'Used by', value: profile.sportLeagueCount },
        ]}
        // poolmaster-allow-list-lookup: pricing profiles are reference data, a handful of rows
        liveProfile={(id) => profilesQuery.data?.find((profile) => profile.id === id)}
        names={(league, profile) => league.platformPricingProfileId === profile.id}
        onStateChange={setDialog}
        renderEditor={(props) => <PlatformPricingProfileEditor {...props} />}
        state={dialog}
        testId="root-admin-pricing-profile-dialog"
      />
      {deleting ? (
        <ProfileDeleteDialog
          invalidates={QueryKeys.rootAdmin.platformPricingProfiles}
          kindLabel="pricing profile"
          name={deleting.name}
          onClose={() => setDeleting(null)}
          remove={async () => {
            const response = await deletePlatformPricingProfile({ path: { profileId: deleting.id } });
            if (response.error) throwApiError(response.error, 'Pricing profile delete failed.');
          }}
          testId="root-admin-pricing-profile-delete"
        />
      ) : null}
    </SectionCard>
  );
}
