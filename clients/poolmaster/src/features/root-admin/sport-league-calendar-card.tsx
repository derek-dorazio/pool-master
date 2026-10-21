import { sportLeagueNounOf } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import { FormField, LinkButton, Select, Tile } from '@/features/shared/ui';
import type { SportLeagueDto } from '@/lib/api';
import { SportLeagueEventCalendar } from './sport-league-event-calendar';
import { SportLeagueYearActions } from './sport-league-year-actions';
import { SportLeagueYearImport } from './sport-league-year-import';
import { buildSportEventListPath, capitalize } from './manage-navigation';
import { useSportLeagueEventsQuery } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';

/**
 * plans/147 — a sport league's events (a tour's tournaments), one event year at a time. It replaced the season
 * list and the season home page: the year a tournament is branded with lives on it, so
 * the years on offer are the ones the tour has tournaments in, plus its current year and
 * the year after the latest (what "clone to next year" and "new tournament" aim at).
 */
export function SportLeagueCalendarCard({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const { sport, definition } = useManagedSport();
  const { event: eventNoun } = definition.vocabulary;
  const tournamentsQuery = useSportLeagueEventsQuery(sportLeague.id);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const yearsWithEvents = useMemo(
    () => [...new Set((tournamentsQuery.data ?? []).map((event) => event.eventYear))].sort((a, b) => b - a),
    [tournamentsQuery.data],
  );
  // Default: the tour's current year, else its latest year with tournaments, else this one.
  // Computed during render so a refetch can't clobber an explicit pick.
  const eventYear = selectedYear ?? sportLeague.currentEventYear ?? yearsWithEvents.at(0) ?? new Date().getFullYear();
  const years = useMemo(
    () => [...new Set([...yearsWithEvents, eventYear, (yearsWithEvents.at(0) ?? eventYear) + 1])].sort((a, b) => b - a),
    [yearsWithEvents, eventYear],
  );
  const yearTournaments = useMemo(
    () => (tournamentsQuery.data ?? []).filter((event) => event.eventYear === eventYear),
    [tournamentsQuery.data, eventYear],
  );

  return (
    <Tile data-testid="root-admin-sport-league-calendar">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{`${capitalize(eventNoun.one)} calendar`}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {`${sportLeague.name}’s ${eventNoun.many} in one year, earliest first.`}
          </p>
        </div>
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
      </div>
      <div className="mt-4">
        <SportLeagueEventCalendar isError={tournamentsQuery.isError} sportLeague={sportLeagueNounOf(sport, sportLeague.noun)} tournaments={yearTournaments} />
      </div>
    </Tile>
  );
}
