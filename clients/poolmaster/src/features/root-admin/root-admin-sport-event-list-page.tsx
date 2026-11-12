import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { listEvents } from '@/lib/api';
import {
  DataGrid,
  QueryState,
  LinkButton,
  StatusBadge,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import {
  syncScopeLabel,
  syncScopeTone,
} from './sport-admin-utils';
import type { SportEventDto } from '@/lib/api';
import {
  buildSportEventListPath,
  buildSportEventPath,
  MANAGE_LIST_PAGE_SIZE,
} from './manage-navigation';
import { EventYearFilter } from './event-year-select';
import { sportEventNameColumn, sportEventScheduleColumns } from './sport-event-columns';
import { useManagedSport } from './use-managed-sport';
import { SportSectionMenu } from './sport-section-menu';
import { upperFirst } from '@/lib/upper-first';

const columnHelper = createColumnHelper<SportEventDto>();

export function RootAdminSportEventListPage() {
  const displayPreferences = useDisplayPreferences();
  const { sport, definition } = useManagedSport();
  const { event } = definition.vocabulary;
  const sportName = definition.name.toLowerCase();
  // One year at a time, this year first (#1313): a sport's events grow every season.
  const [eventYear, setEventYear] = useState(() => new Date().getFullYear());
  const tournamentsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.sportEvents(sport, eventYear),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({ query: { sport, eventYear } });

      if (!response.data?.events) {
        throwApiError(response.error, `The ${sportName} ${event.one} list response is missing data.`);
      }

      return response.data.events;
    },
    retry: false,
  });

  const columns = useMemo(
    () => [
      sportEventNameColumn(upperFirst(event.one)),
      columnHelper.accessor('syncScope', {
        header: 'Sync',
        cell: ({ getValue }) => (
          <StatusBadge tone={syncScopeTone(getValue())}>
            {syncScopeLabel(getValue())}
          </StatusBadge>
        ),
      }),
      ...sportEventScheduleColumns(displayPreferences),
      columnHelper.accessor('loadedParticipantCount', {
        header: 'Field',
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor('tierCount', {
        header: 'Tiers',
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor((row) => row.adminCounts?.contestCount ?? null, {
        id: 'contestCount',
        header: 'Contests',
        cell: ({ getValue }) => getValue(),
      }),
    ],
    [displayPreferences, event.one],
  );

  return (
    <section className="space-y-6" data-testid="root-admin-sport-event-list-page">
      <SportSectionMenu
        actions={(
          <LinkButton
            data-testid="root-admin-sport-event-list-new"
            to={`${buildSportEventListPath(sport)}/new`}
          >
            New {event.one}
          </LinkButton>
        )}
        current="events"
        tabsEnd={<EventYearFilter onChange={setEventYear} testId="root-admin-sport-event-list-year" value={eventYear} />}
      />

      <QueryState
        error={extractErrorMessage(tournamentsQuery.error, {
          fallback: `We could not load ${sportName} ${event.many} right now.`,
        })}
        loading={`Loading ${sportName} ${event.many}...`}
        query={tournamentsQuery}
        testId="root-admin-sport-event-list"
      >
        {(tournaments) => (
          <DataGrid
            columns={columns}
            data={tournaments}
            emptyMessage={`No ${sportName} ${event.many} in ${eventYear}.`}
            filterTestIdPrefix="root-admin-sport-event-list-filter"
            getRowId={(tournament) => tournament.id}
            getRowLink={(tournament) => buildSportEventPath(sport, tournament.id)}
            pageSize={MANAGE_LIST_PAGE_SIZE}
            rowTestId={(tournament) => `root-admin-sport-event-row-${tournament.id}`}
            search={{ label: `Find a ${event.one}`, testId: 'root-admin-sport-event-list-search' }}
            tableTestId="root-admin-sport-event-list-table"
          />
        )}
      </QueryState>
    </section>
  );
}
