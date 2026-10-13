import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Callout,
  LinkButton,
  SegmentedControl,
} from '@/features/shared/ui';
import { GolfTournamentManualCreateForm } from './golf-tournament-manual-create-form';
import { GolfTournamentProviderBrowse } from './golf-tournament-provider-browse';
import type { GolfTournamentEdition } from './golf-tournament-edition';
import { buildSportLeagueListPath, capitalize } from './manage-navigation';
import { useGolfSportLeaguesQuery } from './use-golf-catalog';
import { useManagedSport } from './use-managed-sport';

type CreateMode = 'manual' | 'provider';

/**
 * plans/124 §6.3 / §4.4a — /manage/sports/:sport/events/new. Owns the create mode toggle and
 * the shared, required tour and event year (plans/147 — they replaced the season); the
 * two modes themselves (manual form / provider-event browse) are separate components.
 */
export function RootAdminGolfTournamentCreatePage() {
  const [searchParams] = useSearchParams();
  const initialTourId = searchParams.get('sportLeagueId') ?? '';
  const initialYear = searchParams.get('eventYear') ?? '';

  const [mode, setMode] = useState<CreateMode>('manual');
  const [selection, setSelection] = useState<Partial<GolfTournamentEdition>>({});

  const { sport, definition } = useManagedSport();
  const { event, sportLeague } = definition.vocabulary;
  const sportName = definition.name.toLowerCase();
  const toursQuery = useGolfSportLeaguesQuery(sport);

  // A tournament is created on an active tour only.
  const tours = useMemo(
    () => (toursQuery.data ?? []).filter((tour) => tour.isActive),
    [toursQuery.data],
  );

  // Defaults: the ?sportLeagueId= / ?eventYear= context, else the only tour, and that
  // tour's current year or this calendar year. Computed during render (never written
  // into state from a query effect) so a refetch can't clobber an explicit pick.
  const sportLeagueId = selection.sportLeagueId
    ?? (initialTourId || (tours.length === 1 ? tours[0].id : ''));
  const tour = tours.find((candidate) => candidate.id === sportLeagueId);
  const eventYear = selection.eventYear
    ?? (initialYear || String(tour?.currentEventYear ?? new Date().getFullYear()));
  const edition: GolfTournamentEdition = { sportLeagueId, eventYear };

  const toursLoaded = !toursQuery.isLoading && !toursQuery.isError;

  if (toursLoaded && tours.length === 0) {
    return (
      <section
        className="space-y-4"
        data-testid="root-admin-golf-tournament-create-page"
      >
        <Callout tone="warning">
          <p className="font-medium">
            Create a {sportLeague.one} before creating a {event.one}
          </p>
          <p className="mt-1 text-sm">
            Every {sportName} {event.one} runs on a {sportLeague.one}. There are no active{' '}
            {sportName} {sportLeague.many} yet.
          </p>
          <div className="mt-3">
            <LinkButton
              data-testid="root-admin-golf-tournament-create-tours-link"
              to={buildSportLeagueListPath(sport)}
              variant="secondary"
            >
              Go to {capitalize(sportLeague.many)}
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
        aria-label={`${capitalize(event.one)} creation mode`}
        onChange={(value) => setMode(value as CreateMode)}
        options={[
          { label: 'Build manually', value: 'manual' },
          { label: 'Browse provider events', value: 'provider' },
        ]}
        value={mode}
      />

      {mode === 'manual' ? (
        <GolfTournamentManualCreateForm edition={edition} onEditionChange={setSelection} tours={tours} />
      ) : (
        <GolfTournamentProviderBrowse edition={edition} onEditionChange={setSelection} tours={tours} />
      )}
    </section>
  );
}
