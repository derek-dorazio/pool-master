import { sportLeagueNounOf, sportVocabulary } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { Notice, LinkButton, SectionCard, Text } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import type { SportLeagueDto } from '@/lib/api';
import { seasonIdOrCurrent, useSportLeagueSeasonsQuery } from '@/features/contests/use-sport-league-seasons';
import { SportLeagueEventCalendar } from './sport-league-event-calendar';
import { SeasonSelect } from './season-select';
import { buildSportEventListPath } from './manage-navigation';
import { useSportLeagueEventsQuery } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';
import { upperFirst } from '@/lib/upper-first';

/**
 * A sport league's events (a tour's tournaments), one Season at a time (#2003), opening on its
 * current Season. Seasons are added by migration and a new event goes in the current Season, so
 * the card only picks which Season to show; only that Season's events load (#1251).
 */
export function SportLeagueCalendarCard({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const { sport, sportUrlSegment } = useManagedSport();
  const { event: eventNoun } = sportVocabulary(sport);
  const seasonsQuery = useSportLeagueSeasonsQuery(sportLeague.id);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  // Computed during render so a refetch can't clobber an explicit pick.
  const seasonId = seasonIdOrCurrent(selectedSeasonId, sportLeague);
  const tournamentsQuery = useSportLeagueEventsQuery(sportLeague.id, seasonId);
  const seasonTournaments = tournamentsQuery.data ?? [];

  return (
    <SectionCard
      headingLevel={3}
      padded
      testId="root-admin-sport-league-calendar"
      title={`${upperFirst(eventNoun.one)} calendar`}
    >
      <Text as="p" variant="meta">
        {`${sportLeague.name}’s ${eventNoun.many} in one Season, earliest first.`}
      </Text>
      {seasonsQuery.isError ? (
        <Notice data-testid="root-admin-sport-league-calendar-seasons-error" tone="danger">
          {extractErrorMessage(seasonsQuery.error, { fallback: `We could not load ${sportLeague.name}’s Seasons right now.` })}
        </Notice>
      ) : !seasonsQuery.data ? (
        <Text as="p" variant="meta" data-testid="root-admin-sport-league-calendar-loading">Loading Seasons...</Text>
      ) : seasonId === null ? (
        <Text as="p" variant="meta" data-testid="root-admin-sport-league-calendar-no-season">{`${sportLeague.name} has no Season yet.`}</Text>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <SeasonSelect
            onChange={setSelectedSeasonId}
            seasons={seasonsQuery.data}
            testId="root-admin-sport-league-calendar-season"
            value={seasonId}
          />
          <LinkButton
            data-testid="root-admin-sport-league-calendar-new-tournament"
            size="sm"
            to={`${buildSportEventListPath(sportUrlSegment)}/new?sportLeagueId=${sportLeague.id}`}
          >
            {`New ${eventNoun.one}`}
          </LinkButton>
        </div>
      )}
      {seasonId === null ? null : (
        <SportLeagueEventCalendar isError={tournamentsQuery.isError} sportLeague={sportLeagueNounOf(sport, sportLeague.noun)} tournaments={seasonTournaments} />
      )}
    </SectionCard>
  );
}
