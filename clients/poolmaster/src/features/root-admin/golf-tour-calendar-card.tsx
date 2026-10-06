import { useMemo, useState } from 'react';
import { FormField, LinkButton, Select, Tile } from '@/features/shared/ui';
import type { SportLeagueDto } from '@/lib/api';
import { GolfTourTournamentCalendar } from './golf-tour-tournament-calendar';
import { GolfTourYearActions } from './golf-tour-year-actions';
import { GolfTourYearImport } from './golf-tour-year-import';
import { useGolfTourTournamentsQuery } from './use-golf-catalog';

/**
 * plans/147 — a tour's tournaments, one event year at a time. It replaced the season
 * list and the season home page: the year a tournament is branded with lives on it, so
 * the years on offer are the ones the tour has tournaments in, plus its current year and
 * the year after the latest (what "clone to next year" and "new tournament" aim at).
 */
export function GolfTourCalendarCard({ tour }: { tour: SportLeagueDto }) {
  const tournamentsQuery = useGolfTourTournamentsQuery(tour.id);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const yearsWithEvents = useMemo(
    () => [...new Set((tournamentsQuery.data ?? []).map((event) => event.eventYear))].sort((a, b) => b - a),
    [tournamentsQuery.data],
  );
  // Default: the tour's current year, else its latest year with tournaments, else this one.
  // Computed during render so a refetch can't clobber an explicit pick.
  const eventYear = selectedYear ?? tour.currentEventYear ?? yearsWithEvents[0] ?? new Date().getFullYear();
  const years = useMemo(
    () => [...new Set([...yearsWithEvents, eventYear, (yearsWithEvents[0] ?? eventYear) + 1])].sort((a, b) => b - a),
    [yearsWithEvents, eventYear],
  );
  const yearTournaments = useMemo(
    () => (tournamentsQuery.data ?? []).filter((event) => event.eventYear === eventYear),
    [tournamentsQuery.data, eventYear],
  );

  return (
    <Tile data-testid="root-admin-golf-tour-calendar">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Tournament calendar</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {tour.name}&rsquo;s tournaments in one year, earliest first.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Year">
            <Select
              data-testid="root-admin-golf-tour-calendar-year"
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
          <GolfTourYearActions
            eventCount={yearTournaments.length}
            eventYear={eventYear}
            onCloned={setSelectedYear}
            tour={tour}
          />
          <GolfTourYearImport eventYear={eventYear} tour={tour} />
          <LinkButton
            data-testid="root-admin-golf-tour-calendar-new-tournament"
            size="sm"
            to={`/manage/golf/tournaments/new?sportLeagueId=${tour.id}&eventYear=${eventYear}`}
          >
            New tournament
          </LinkButton>
        </div>
      </div>
      <div className="mt-4">
        <GolfTourTournamentCalendar isError={tournamentsQuery.isError} tournaments={yearTournaments} />
      </div>
    </Tile>
  );
}
