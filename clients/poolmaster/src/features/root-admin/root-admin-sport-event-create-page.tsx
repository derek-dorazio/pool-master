import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Callout,
  LinkButton,
  SegmentedControl,
} from '@/features/shared/ui';
import { SportEventManualCreateForm } from './sport-event-manual-create-form';
import { SportEventProviderBrowse } from './sport-event-provider-browse';
import type { SportEventEdition } from './sport-event-edition';
import { buildSportLeagueListPath, capitalize } from './manage-navigation';
import { useSportLeaguesQuery } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';

type CreateMode = 'manual' | 'provider';

/**
 * plans/124 §6.3 / §4.4a — /manage/sports/:sport/events/new. Owns the create mode toggle and
 * the shared, required tour and event year (plans/147 — they replaced the season); the
 * two modes themselves (manual form / provider-event browse) are separate components.
 */
export function RootAdminSportEventCreatePage() {
  const [searchParams] = useSearchParams();
  const initialSportLeagueId = searchParams.get('sportLeagueId') ?? '';
  const initialYear = searchParams.get('eventYear') ?? '';

  const [mode, setMode] = useState<CreateMode>('manual');
  const [selection, setSelection] = useState<Partial<SportEventEdition>>({});

  const { sport, definition } = useManagedSport();
  const { event, sportLeague: sportLeagueNoun } = definition.vocabulary;
  const sportName = definition.name.toLowerCase();
  const sportLeaguesQuery = useSportLeaguesQuery(sport);

  // A tournament is created on an active tour only.
  const sportLeagues = useMemo(
    () => (sportLeaguesQuery.data ?? []).filter((sportLeague) => sportLeague.isActive),
    [sportLeaguesQuery.data],
  );

  // Defaults: the ?sportLeagueId= / ?eventYear= context, else the only tour, and that
  // tour's current year or this calendar year. Computed during render (never written
  // into state from a query effect) so a refetch can't clobber an explicit pick.
  const sportLeagueId = selection.sportLeagueId
    ?? (initialSportLeagueId || (sportLeagues.length === 1 ? sportLeagues[0].id : ''));
  const sportLeague = sportLeagues.find((candidate) => candidate.id === sportLeagueId);
  const eventYear = selection.eventYear
    ?? (initialYear || String(sportLeague?.currentEventYear ?? new Date().getFullYear()));
  const edition: SportEventEdition = { sportLeagueId, eventYear };

  const sportLeaguesLoaded = !sportLeaguesQuery.isLoading && !sportLeaguesQuery.isError;

  if (sportLeaguesLoaded && sportLeagues.length === 0) {
    return (
      <section
        className="space-y-4"
        data-testid="root-admin-sport-event-create-page"
      >
        <Callout tone="warning">
          <p className="font-medium">
            Create a {sportLeagueNoun.one} before creating a {event.one}
          </p>
          <p className="mt-1 text-sm">
            Every {sportName} {event.one} runs on a {sportLeagueNoun.one}. There are no active{' '}
            {sportName} {sportLeagueNoun.many} yet.
          </p>
          <div className="mt-3">
            <LinkButton
              data-testid="root-admin-sport-event-create-tours-link"
              to={buildSportLeagueListPath(sport)}
              variant="secondary"
            >
              Go to {capitalize(sportLeagueNoun.many)}
            </LinkButton>
          </div>
        </Callout>
      </section>
    );
  }

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-sport-event-create-page"
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
        <SportEventManualCreateForm edition={edition} onEditionChange={setSelection} sportLeagues={sportLeagues} />
      ) : (
        <SportEventProviderBrowse edition={edition} onEditionChange={setSelection} sportLeagues={sportLeagues} />
      )}
    </section>
  );
}
