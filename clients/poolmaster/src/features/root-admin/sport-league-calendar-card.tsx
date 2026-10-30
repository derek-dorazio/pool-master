import { sportLeagueNounOf } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import { Alert, FormField, LinkButton, PanelCard, Select } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import type { SportLeagueDto } from '@/lib/api';
import { SportLeagueEventCalendar } from './sport-league-event-calendar';
import { SportLeagueYearActions } from './sport-league-year-actions';
import { SportLeagueYearImport } from './sport-league-year-import';
import { buildSportEventListPath, capitalize } from './manage-navigation';
import { useSportLeagueEventsQuery, useSportLeagueEventYearsQuery } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';

/**
 * plans/147 — a sport league's events (a tour's tournaments), one event year at a time. It replaced the season
 * list and the season home page: the year a tournament is branded with lives on it, so
 * the years on offer are the ones the tour has tournaments in, plus its current year and
 * the year after the latest (what "clone to next year" and "new tournament" aim at). The
 * years come from their own small read, and only the chosen year's tournaments load (#1251).
 */
export function SportLeagueCalendarCard({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const { sport, definition } = useManagedSport();
  const { event: eventNoun } = definition.vocabulary;
  const yearsQuery = useSportLeagueEventYearsQuery(sportLeague.id);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const yearsWithEvents = useMemo(() => yearsQuery.data ?? [], [yearsQuery.data]);
  // Default: the tour's current year, else its latest year with tournaments, else this one.
  // Computed during render so a refetch can't clobber an explicit pick. Without a current year
  // the years read decides, so no year's tournaments load before it answers; a failed one says so.
  const eventYear = selectedYear ?? sportLeague.currentEventYear
    ?? (yearsQuery.isSuccess ? yearsWithEvents.at(0) ?? new Date().getFullYear() : null);
  const tournamentsQuery = useSportLeagueEventsQuery(sportLeague.id, eventYear);
  const yearTournaments = tournamentsQuery.data ?? [];
  const years = useMemo(
    () => eventYear === null
      ? []
      : [...new Set([...yearsWithEvents, eventYear, (yearsWithEvents.at(0) ?? eventYear) + 1])].sort((a, b) => b - a),
    [yearsWithEvents, eventYear],
  );

  return (
    <PanelCard
      headingLevel={3}
      padded
      testId="root-admin-sport-league-calendar"
      title={`${capitalize(eventNoun.one)} calendar`}
    >
      <p className="text-sm text-muted-foreground">
        {`${sportLeague.name}’s ${eventNoun.many} in one year, earliest first.`}
      </p>
      {yearsQuery.isError ? (
        <Alert data-testid="root-admin-sport-league-calendar-years-error" tone="danger">
          {extractErrorMessage(yearsQuery.error, { fallback: `We could not load ${sportLeague.name}’s years right now.` })}
        </Alert>
      ) : eventYear === null ? (
        <p className="text-sm text-muted-foreground" data-testid="root-admin-sport-league-calendar-loading">Loading years...</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Year">
            <Select
              data-testid="root-admin-sport-league-calendar-year"
              onChange={(event) => setSelectedYear(Number.parseInt(event.target.value, 10))}
              value={String(eventYear)}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </FormField>
          <SportLeagueYearActions
            // poolmaster-allow-list-lookup: counts the year's tournaments, every one shown in the calendar below
            eventCount={yearTournaments.length}
            eventYear={eventYear}
            onCloned={setSelectedYear}
            sportLeague={sportLeague}
          />
          <SportLeagueYearImport eventYear={eventYear} sportLeague={sportLeague} />
          <LinkButton
            data-testid="root-admin-sport-league-calendar-new-tournament"
            size="sm"
            to={`${buildSportEventListPath(sport)}/new?sportLeagueId=${sportLeague.id}&eventYear=${eventYear}`}
          >
            {`New ${eventNoun.one}`}
          </LinkButton>
        </div>
      )}
      {eventYear === null ? null : (
        <SportLeagueEventCalendar isError={tournamentsQuery.isError} sportLeague={sportLeagueNounOf(sport, sportLeague.noun)} tournaments={yearTournaments} />
      )}
    </PanelCard>
  );
}
