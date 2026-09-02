import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminListGolfSeasons } from '@/lib/api';
import {
  Callout,
  LinkButton,
  SegmentedControl,
} from '@/features/shared/ui';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminListGolfSeasonsResponses } from '@/lib/api';
import { GolfTournamentManualCreateForm } from './golf-tournament-manual-create-form';
import { GolfTournamentProviderBrowse } from './golf-tournament-provider-browse';

type GolfSeason = AdminListGolfSeasonsResponses[200]['seasons'][number];
type CreateMode = 'manual' | 'provider';

/**
 * plans/124 §6.3 / §4.4a — /manage/golf/tournaments/new. Owns the create mode
 * toggle and the shared, required Season resolution; the two modes themselves
 * (manual form / provider-event browse) are separate components.
 */
export function RootAdminGolfTournamentCreatePage() {
  const [searchParams] = useSearchParams();
  const initialSeasonId = searchParams.get('seasonId') ?? '';

  const [mode, setMode] = useState<CreateMode>('manual');
  const [seasonSelection, setSeasonSelection] = useState(initialSeasonId);

  const seasonsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.seasons(),
    queryFn: async (): Promise<GolfSeason[]> => {
      const response = await adminListGolfSeasons({ query: { isActive: true } });
      if (!response.data?.seasons) {
        throw response.error ?? new Error('Golf season list response is missing data.');
      }
      return response.data.seasons;
    },
    retry: false,
  });

  const seasons = useMemo(
    () =>
      [...(seasonsQuery.data ?? [])].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      ),
    [seasonsQuery.data],
  );

  // Default season: the ?seasonId= context, else the most recently created active
  // season. Computed during render (never written into state from a query effect)
  // so a refetch can't clobber an explicit pick.
  const defaultSeasonId = initialSeasonId || seasons[0]?.id || '';
  const seasonId = seasonSelection || defaultSeasonId;
  const scopedSeason = seasons.find((season) => season.id === seasonId);

  const seasonsLoaded = !seasonsQuery.isLoading && !seasonsQuery.isError;

  if (seasonsLoaded && seasons.length === 0) {
    return (
      <section
        className="space-y-4"
        data-testid="root-admin-golf-tournament-create-page"
      >
        <Callout tone="warning">
          <p className="font-medium">Create a season before creating a tournament</p>
          <p className="mt-1 text-sm">
            Every golf tournament belongs to one season of a tour. There are no active
            golf seasons yet.
          </p>
          <div className="mt-3">
            <LinkButton
              data-testid="root-admin-golf-tournament-create-seasons-link"
              to="/manage/golf/seasons"
              variant="secondary"
            >
              Go to Seasons
            </LinkButton>
          </div>
        </Callout>
      </section>
    );
  }

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-golf-tournament-create-page"
    >
      <SegmentedControl
        aria-label="Tournament creation mode"
        onChange={(value) => setMode(value as CreateMode)}
        options={[
          { label: 'Build manually', value: 'manual' },
          { label: 'Browse provider events', value: 'provider' },
        ]}
        value={mode}
      />

      {mode === 'manual' ? (
        <GolfTournamentManualCreateForm
          onSeasonChange={setSeasonSelection}
          seasonId={seasonId}
          seasons={seasons}
        />
      ) : (
        <GolfTournamentProviderBrowse
          onSeasonChange={setSeasonSelection}
          scopedSeason={scopedSeason}
          seasonId={seasonId}
          seasons={seasons}
        />
      )}
    </section>
  );
}
