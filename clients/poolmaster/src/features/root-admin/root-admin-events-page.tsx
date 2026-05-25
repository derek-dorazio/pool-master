import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  adminListEventParticipants,
  adminListEvents,
  type AdminListEventParticipantsResponses,
  type AdminListEventsResponses,
} from '@/lib/api';
import {
  Button,
  DataGrid,
  DataGridPage,
  formatDateTimeDisplay,
  Modal,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

type AdminEvent = AdminListEventsResponses[200]['events'][number];
type AdminEventParticipant =
  AdminListEventParticipantsResponses[200]['participants'][number];

const eventColumnHelper = createColumnHelper<AdminEvent>();
const participantColumnHelper = createColumnHelper<AdminEventParticipant>();

function formatOptionalText(value: string | number | undefined) {
  return value === undefined || value === '' ? 'Unknown' : String(value);
}

function formatReadiness(status: AdminEvent['readinessStatus']) {
  return status
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function readinessTone(status: AdminEvent['readinessStatus']) {
  if (status === 'CONTEST_ELIGIBLE') return 'success';
  if (status === 'FIELD_LOCKED') return 'locked';
  if (status === 'PENDING_FIELD') return 'warning';
  return 'neutral';
}

function eventStatusTone(status: AdminEvent['status']) {
  if (status === 'IN_PROGRESS') return 'live';
  if (status === 'COMPLETED' || status === 'OFFICIAL') return 'completed';
  if (status === 'CANCELLED' || status === 'POSTPONED') return 'warning';
  return 'neutral';
}

function formatSignedNumber(value: number | undefined) {
  if (value === undefined) {
    return 'Unknown';
  }
  if (value > 0) {
    return `+${value}`;
  }
  return String(value);
}

function formatFieldCount(event: AdminEvent) {
  const providerCount = event.participantCount ?? 'unknown';
  return `${event.loadedParticipantCount} loaded / ${providerCount} provider`;
}

export function RootAdminEventsPage() {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const eventsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.events,
    queryFn: async (): Promise<AdminEvent[]> => {
      const response = await adminListEvents({
        query: {
          limit: 250,
        },
      });

      if (!response.data?.events) {
        throw response.error ?? new Error('Event browser response is missing data.');
      }

      return response.data.events;
    },
    retry: false,
  });

  const participantsQuery = useQuery({
    enabled: selectedEventId !== null,
    queryKey: QueryKeys.rootAdmin.eventParticipants(selectedEventId),
    queryFn: async (): Promise<AdminListEventParticipantsResponses[200]> => {
      if (!selectedEventId) {
        throw new Error('Select an event before loading participants.');
      }

      const response = await adminListEventParticipants({
        path: {
          eventId: selectedEventId,
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Event participant response is missing data.');
      }

      return response.data;
    },
    retry: false,
  });

  const eventColumns = useMemo(
    () => [
      eventColumnHelper.accessor('name', {
        id: 'event',
        header: 'Event',
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
        cell: ({ getValue }) => (
          <StatusBadge tone="info">{getValue()}</StatusBadge>
        ),
      }),
      eventColumnHelper.accessor('providerId', {
        header: 'Source',
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue()}</span>
        ),
      }),
      eventColumnHelper.accessor('startDate', {
        header: 'Starts',
        cell: ({ getValue }) => formatDateTimeDisplay(getValue()),
      }),
      eventColumnHelper.accessor('status', {
        header: 'Status',
        cell: ({ getValue }) => (
          <StatusBadge tone={eventStatusTone(getValue())}>{getValue()}</StatusBadge>
        ),
      }),
      eventColumnHelper.accessor('readinessStatus', {
        header: 'Readiness',
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
      eventColumnHelper.accessor((event) => formatFieldCount(event), {
        id: 'field',
        header: 'Field',
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
        cell: ({ row }) => (
          <Button
            data-testid={`root-admin-event-participants-${row.original.id}`}
            onClick={() => setSelectedEventId(row.original.id)}
            size="sm"
            type="button"
            variant="secondary"
          >
            View
          </Button>
        ),
        enableColumnFilter: false,
        enableSorting: false,
      }),
    ],
    [],
  );

  const participantColumns = useMemo(
    () => [
      participantColumnHelper.accessor('participantName', {
        id: 'participant',
        header: 'Participant',
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-foreground">
              {row.original.participantName}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {formatOptionalText(row.original.shortName)}
            </div>
          </div>
        ),
      }),
      participantColumnHelper.accessor('status', {
        header: 'Status',
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() === 'ACTIVE' ? 'active' : 'neutral'}>
            {formatOptionalText(getValue())}
          </StatusBadge>
        ),
      }),
      participantColumnHelper.accessor('worldRanking', {
        header: 'World rank',
        cell: ({ getValue }) => formatOptionalText(getValue()),
      }),
      participantColumnHelper.accessor('oddsToWin', {
        header: 'Odds',
        cell: ({ getValue }) => formatOptionalText(getValue()),
      }),
      participantColumnHelper.accessor('valuationTier', {
        header: 'Tier',
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-foreground">
              {formatOptionalText(row.original.valuationTier)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Price {formatOptionalText(row.original.valuationPrice)}
            </div>
          </div>
        ),
      }),
      participantColumnHelper.accessor('scoreToPar', {
        header: 'Score',
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-foreground">
              {formatSignedNumber(row.original.scoreToPar)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {row.original.roundCount} rounds, strokes {formatOptionalText(row.original.totalStrokes)}
            </div>
          </div>
        ),
      }),
      participantColumnHelper.accessor('updatedAt', {
        header: 'Updated',
        cell: ({ getValue }) => formatDateTimeDisplay(getValue()),
      }),
    ],
    [],
  );

  const participantModalTitle = participantsQuery.data?.event.name
    ?? eventsQuery.data?.find((event) => event.id === selectedEventId)?.name
    ?? 'Event participants';
  const participantModalDescription = participantsQuery.data
    ? `${participantsQuery.data.event.providerId} current database state`
    : 'Current persisted participant field for this event.';

  return (
    <>
      <DataGridPage
        columns={eventColumns}
        data={eventsQuery.data ?? []}
        emptyMessage="No events matched the current filters."
        errorBody={extractErrorMessage(
          eventsQuery.error,
          { fallback: 'We could not load events right now.' },
        )}
        filterTestIdPrefix="root-admin-events-filter"
        getRowId={(event) => event.id}
        loadingBody="Loading events..."
        rowTestId={(event) => `root-admin-event-row-${event.id}`}
        state={
          eventsQuery.isLoading
            ? 'loading'
            : eventsQuery.isError
              ? 'error'
              : 'ready'
        }
        tableTestId="root-admin-events-table"
        testId="root-admin-events-page"
      />

      <Modal
        description={participantModalDescription}
        footer={
          <Button onClick={() => setSelectedEventId(null)} type="button">
            Close
          </Button>
        }
        onClose={() => setSelectedEventId(null)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEventId(null);
          }
        }}
        open={selectedEventId !== null}
        size="lg"
        testId="root-admin-event-participants-modal"
        title={participantModalTitle}
      >
        {participantsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading participants...</p>
        ) : participantsQuery.isError ? (
          <p className="text-sm text-[color:var(--status-danger-text)]">
            {extractErrorMessage(participantsQuery.error, {
              fallback: 'We could not load event participants right now.',
            })}
          </p>
        ) : (
          <DataGrid
            columns={participantColumns}
            data={participantsQuery.data?.participants ?? []}
            emptyMessage="No participants are currently loaded for this event."
            filterTestIdPrefix="root-admin-event-participants-filter"
            getRowId={(participant) => participant.id}
            rowTestId={(participant) =>
              `root-admin-event-participant-row-${participant.id}`
            }
            tableTestId="root-admin-event-participants-table"
          />
        )}
      </Modal>
    </>
  );
}
