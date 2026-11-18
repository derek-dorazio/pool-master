import { createColumnHelper } from '@tanstack/react-table';
import { SportEventStatusOrder, SportOrder } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listEvents, type SportEventDto } from '@/lib/api';
import {
  DataGrid,
  Input,
  LinkButton,
  PageHeader,
  QueryState,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import {
  formatSportEventStatus,
  sportEventStatusTone,
} from './sport-admin-utils';
import { EventYearFilter } from './event-year-select';
import { buildSportEventPath, MANAGE_LIST_PAGE_SIZE } from './manage-navigation';

type AdminEvent = SportEventDto;

const eventColumnHelper = createColumnHelper<AdminEvent>();

// Shared SCREAMING_SNAKE -> Title Case formatter, lifted to sport-admin-utils so
// the golf-admin screens and this browser use one implementation (plans/124 §6.4).
const formatReadiness = formatSportEventStatus;

function readinessTone(status: AdminEvent['readinessStatus']) {
  if (status === 'CONTEST_ELIGIBLE') return 'success';
  if (status === 'EVENT_STARTED') return 'locked';
  if (status === 'PENDING_FIELD') return 'warning';
  return 'neutral';
}

export function RootAdminEventsPage() {
  const [eventYear, setEventYear] = useState(() => new Date().getFullYear());
  const [searchTerm, setSearchTerm] = useState('');

  const eventsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.eventsByYear(eventYear),
    queryFn: async (): Promise<AdminEvent[]> => {
      // #235 — the canonical event list; the admin copy of it is gone. Nothing pages it (§16);
      // the event list needs a filter (#1180), so the browser reads one year at a time.
      const response = await listEvents({ query: { eventYear } });

      if (!response.data?.events) {
        throwApiError(response.error, 'Event browser response is missing data.');
      }

      return response.data.events;
    },
    retry: false,
  });

  const eventColumns = useMemo(
    () => [
      eventColumnHelper.accessor('name', {
        id: 'event',
        header: 'Event',
        meta: { info: "The event's name, with the provider's id for it underneath.", type: { kind: 'text' } },
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-foreground">{row.original.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {row.original.externalId}
            </div>
          </div>
        ),
      }),
      eventColumnHelper.accessor('sport', {
        header: 'Sport',
        meta: { info: 'The sport the event belongs to.', type: { kind: 'enum', order: SportOrder } },
        cell: ({ getValue }) => (
          <StatusBadge tone="info">{getValue()}</StatusBadge>
        ),
      }),
      eventColumnHelper.accessor('providerId', {
        header: 'Source',
        meta: { info: 'The data provider the event came from.', type: { kind: 'enum' } },
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue()}</span>
        ),
      }),
      eventColumnHelper.accessor('startDate', {
        header: 'Starts',
        meta: { info: 'When the event starts, in your time zone.', type: { kind: 'datetime', direction: 'both' } },
      }),
      eventColumnHelper.accessor('status', {
        header: 'Status',
        meta: { info: 'Where the event is in its life: Draft, Scheduled, Postponed, In progress, Completed or Cancelled.', type: { kind: 'enum', order: SportEventStatusOrder } },
        cell: ({ getValue }) => (
          <StatusBadge tone={sportEventStatusTone(getValue())}>{getValue()}</StatusBadge>
        ),
      }),
      eventColumnHelper.accessor('readinessStatus', {
        header: 'Readiness',
        meta: { info: 'Whether the event is ready for contests, and what is missing if not.', type: { kind: 'enum', label: formatReadiness } },
        cell: ({ row }) => (
          <div>
            <StatusBadge tone={readinessTone(row.original.readinessStatus)}>
              {formatReadiness(row.original.readinessStatus)}
            </StatusBadge>
            {row.original.readinessReasons.length ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {row.original.readinessReasons.join(', ')}
              </div>
            ) : null}
          </div>
        ),
      }),
      eventColumnHelper.accessor('loadedParticipantCount', {
        id: 'field',
        header: 'Field',
        meta: { info: "How many participants are loaded into the event's field, with the provider's own count underneath.", type: { kind: 'number' } },
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-foreground">
              {row.original.loadedParticipantCount}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Provider count {row.original.participantCount ?? 'unknown'}
            </div>
          </div>
        ),
      }),
      eventColumnHelper.display({
        id: 'participants',
        header: 'Participants',
        meta: { info: "Opens the event's field, where its participants are managed." },
        // The field lives on the event's own Field page, in its sport's Manage section.
        cell: ({ row }) => (
          <LinkButton
            data-testid={`root-admin-event-participants-${row.original.id}`}
            size="sm"
            to={`${buildSportEventPath(row.original.sport, row.original.id)}/field`}
            variant="secondary"
          >
            Field
          </LinkButton>
        ),
        enableColumnFilter: false,
        enableSorting: false,
      }),
    ],
    [],
  );

  return (
    <section className="space-y-6" data-testid="root-admin-events-page">
      <PageHeader
        search={(
          <Input
            aria-label="Find an event"
            data-testid="root-admin-events-search"
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Find an event"
            type="search"
            value={searchTerm}
          />
        )}
        tabsEnd={<EventYearFilter onChange={setEventYear} testId="root-admin-events-year" value={eventYear} />}
        testId="root-admin-events-header"
        title="Events"
      />

      <QueryState
        error={extractErrorMessage(eventsQuery.error, { fallback: 'We could not load events right now.' })}
        loading="Loading events..."
        query={eventsQuery}
        testId="root-admin-events"
      >
        {(events) => (
          <DataGrid
            columns={eventColumns}
            data={events}
            emptyMessage={`No events in ${eventYear}.`}
            filterTestIdPrefix="root-admin-events-filter"
            getRowId={(event) => event.id}
            pageSize={MANAGE_LIST_PAGE_SIZE}
            rowTestId={(event) => `root-admin-event-row-${event.id}`}
            searchTerm={searchTerm}
            tableTestId="root-admin-events-table"
          />
        )}
      </QueryState>

    </section>
  );
}
