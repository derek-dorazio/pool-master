import { sportVocabulary } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Notice, PageHeader } from '@/features/shared/ui';
import { SportEventManualCreateForm } from './sport-event-manual-create-form';
import type { SportEventEdition } from './sport-event-edition';
import { useSportLeaguesQuery } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';

/**
 * plans/124 §6.3 / §4.4a — /manage/sports/:sport/events/new. Owns the required tour; the form
 * makes a test event on a free test slot of the tour's current Season (#2004). A provider's events
 * are never created here: sync creates them.
 */
export function RootAdminSportEventCreatePage() {
  const [searchParams] = useSearchParams();
  const initialSportLeagueId = searchParams.get('sportLeagueId') ?? '';

  const [selection, setSelection] = useState<Partial<SportEventEdition>>({});

  const { sport, definition } = useManagedSport();
  const { event, sportLeague: sportLeagueNoun } = sportVocabulary(definition);
  const sportName = definition.name.toLowerCase();
  const sportLeaguesQuery = useSportLeaguesQuery(sport);

  // A tournament is created on an active tour only.
  const sportLeagues = useMemo(
    () => (sportLeaguesQuery.data ?? []).filter((sportLeague) => sportLeague.isActive),
    [sportLeaguesQuery.data],
  );

  // Default: the ?sportLeagueId= context, else the only tour. Computed during render (never
  // written into state from a query effect) so a refetch can't clobber an explicit pick.
  const sportLeagueId = selection.sportLeagueId
    ?? (initialSportLeagueId || (sportLeagues.length === 1 ? sportLeagues[0].id : ''));
  const edition: SportEventEdition = { sportLeagueId };

  const sportLeaguesLoaded = !sportLeaguesQuery.isLoading && !sportLeaguesQuery.isError;

  if (sportLeaguesLoaded && sportLeagues.length === 0) {
    return (
      <section
        className="space-y-4"
        data-testid="root-admin-sport-event-create-page"
      >
        <Notice tone="warning">
          <p className="font-medium">
            No active {sportLeagueNoun.one} for a {event.one}
          </p>
          <p className="mt-1 text-sm">
            Every {sportName} {event.one} runs on a {sportLeagueNoun.one}. There are no active{' '}
            {sportName} {sportLeagueNoun.many} yet.
          </p>
        </Notice>
      </section>
    );
  }

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-sport-event-create-page"
    >
      <PageHeader testId="root-admin-sport-event-create-header" title={`New test ${event.one}`} />
      <SportEventManualCreateForm edition={edition} onEditionChange={setSelection} sportLeagues={sportLeagues} />
    </section>
  );
}
