import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { listEvents } from '@/lib/api';
import {
  DataGridPage,
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
  capitalize,
  MANAGE_LIST_PAGE_SIZE,
} from './manage-navigation';
import { sportEventNameColumn, sportEventScheduleColumns } from './sport-event-columns';
import { useManagedSport } from './use-managed-sport';
import { SportSectionMenu } from './sport-section-menu';

const columnHelper = createColumnHelper<SportEventDto>();

export function RootAdminSportEventListPage() {
  const displayPreferences = useDisplayPreferences();
  const { sport, definition } = useManagedSport();
  const { event } = definition.vocabulary;
  const sportName = definition.name.toLowerCase();
  const tournamentsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.sportEvents(sport),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({ query: { sport } });

      if (!response.data?.events) {
        throwApiError(response.error, `The ${sportName} ${event.one} list response is missing data.`);
      }

      return response.data.events;
    },
    retry: false,
  });

  const columns = useMemo(
    () => [
      sportEventNameColumn(capitalize(event.one)),
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
    <div className="space-y-4">
      <SportSectionMenu current="events" />
      <div className="flex justify-end">
        <LinkButton
          data-testid="root-admin-sport-event-list-new"
          to={`${buildSportEventListPath(sport)}/new`}
        >
          New {event.one}
        </LinkButton>
      </div>

      <DataGridPage
        columns={columns}
        data={tournamentsQuery.data ?? []}
        emptyMessage={`No ${sportName} ${event.many} have been created yet.`}
        errorBody={extractErrorMessage(tournamentsQuery.error, {
          fallback: `We could not load ${sportName} ${event.many} right now.`,
        })}
        filterTestIdPrefix="root-admin-sport-event-list-filter"
        getRowId={(tournament) => tournament.id}
        getRowLink={(tournament) => buildSportEventPath(sport, tournament.id)}
        loadingBody={`Loading ${sportName} ${event.many}...`}
        pageSize={MANAGE_LIST_PAGE_SIZE}
        rowTestId={(tournament) => `root-admin-sport-event-row-${tournament.id}`}
        search={{ label: `Find a ${event.one}`, testId: 'root-admin-sport-event-list-search' }}
        state={
          tournamentsQuery.isLoading
            ? 'loading'
            : tournamentsQuery.isError
              ? 'error'
              : 'ready'
        }
        tableTestId="root-admin-sport-event-list-table"
        testId="root-admin-sport-event-list-page"
      />
    </div>
  );
}
