import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PARTICIPANT_SCORING_DEFINITIONS, formatParticipantStatusLabel } from '@poolmaster/shared/domain';
import {
  listEventParticipants,
  listEventTiers,
  listEvents,
  type SportEventDto,
  type SportEventParticipantDto,
  type SportEventTierDto,
} from '@/lib/api';
import {
  Button,
  DataGrid,
  DataGridPage,
  formatDateTimeDisplay,
  Modal,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import {
  formatSportEventStatus,
  sportEventStatusTone,
} from './golf-admin-utils';

type AdminEvent = SportEventDto;

const eventColumnHelper = createColumnHelper<AdminEvent>();
const participantColumnHelper = createColumnHelper<SportEventParticipantDto>();

function formatOptionalText(value: string | number | null | undefined) {
  return value === undefined || value === null || value === '' ? 'Unknown' : String(value);
}

/** The standing's status once scoring has started, else whether the golfer is still in the field. */
function participantStatus(participant: SportEventParticipantDto): string {
  return participant.standing?.status
    ?? (participant.isActive ? 'ACTIVE' : participant.inactiveReason ?? 'INACTIVE');
}

// Shared SCREAMING_SNAKE -> Title Case formatter, lifted to golf-admin-utils so
// the golf-admin screens and this browser use one implementation (plans/124 §6.4).
const formatReadiness = formatSportEventStatus;

function readinessTone(status: AdminEvent['readinessStatus']) {
  if (status === 'CONTEST_ELIGIBLE') return 'success';
  if (status === 'EVENT_STARTED') return 'locked';
  if (status === 'PENDING_FIELD') return 'warning';
  return 'neutral';
}

function formatScoreToPar(value: number | undefined) {
  if (value === undefined) {
    return 'Unknown';
  }
  return PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL.format(value);
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
      // #235 — the canonical event list; the admin copy of it is gone. Nothing pages it (§16),
      // so the browser now shows every event rather than the first 250.
      const response = await listEvents();

      if (!response.data?.events) {
        throwApiError(response.error, 'Event browser response is missing data.');
      }

      return response.data.events;
    },
    retry: false,
  });

  // #235/#236 — the event's field is the shared listEventParticipants read; the admin
  // projection of it is gone. Tier labels come from the event's tiers.
  const participantsQuery = useQuery({
    enabled: selectedEventId !== null,
    queryKey: QueryKeys.rootAdmin.eventParticipants(selectedEventId),
    queryFn: async (): Promise<{ participants: SportEventParticipantDto[]; tiers: SportEventTierDto[] }> => {
      if (!selectedEventId) {
        throw new Error('Select an event before loading participants.');
      }

      const [participantsResponse, tiersResponse] = await Promise.all([
        listEventParticipants({ path: { eventId: selectedEventId } }),
        listEventTiers({ path: { eventId: selectedEventId } }),
      ]);

      if (!participantsResponse.data?.participants) {
        throwApiError(participantsResponse.error, 'Event participant response is missing data.');
      }
      if (!tiersResponse.data?.tiers) {
        throwApiError(tiersResponse.error, 'Event tier response is missing data.');
      }

      return { participants: participantsResponse.data.participants, tiers: tiersResponse.data.tiers };
    },
    retry: false,
  });

  const selectedSport = eventsQuery.data?.find((event) => event.id === selectedEventId)?.sport;

  const tierLabelById = useMemo(
    () => new Map((participantsQuery.data?.tiers ?? []).map((tier) => [tier.id, tier.label])),
    [participantsQuery.data?.tiers],
  );

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
          <StatusBadge tone={sportEventStatusTone(getValue())}>{getValue()}</StatusBadge>
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
      participantColumnHelper.accessor((participant) => participant.participant.name, {
        id: 'participant',
        header: 'Participant',
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-foreground">
              {row.original.participant.name}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {formatOptionalText(row.original.participant.shortName)}
            </div>
          </div>
        ),
      }),
      participantColumnHelper.accessor(participantStatus, {
        id: 'status',
        header: 'Status',
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() === 'ACTIVE' ? 'active' : 'neutral'}>
            {formatParticipantStatusLabel(getValue(), selectedSport)}
          </StatusBadge>
        ),
      }),
      participantColumnHelper.accessor('ranking', {
        header: 'Ranking',
        cell: ({ getValue }) => formatOptionalText(getValue()),
      }),
      participantColumnHelper.accessor('oddsToWin', {
        header: 'Odds',
        cell: ({ getValue }) => formatOptionalText(getValue()),
      }),
      participantColumnHelper.accessor(
        (participant) => tierLabelById.get(participant.valuation?.sportEventTierId ?? '') ?? null,
        {
          id: 'tier',
          header: 'Tier',
          cell: ({ getValue, row }) => (
            <div>
              <div className="font-medium text-foreground">
                {formatOptionalText(getValue())}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Price {formatOptionalText(row.original.valuation?.price)}
              </div>
            </div>
          ),
        },
      ),
      participantColumnHelper.accessor((participant) => participant.standing?.golf?.eventScoreToPar, {
        id: 'score',
        header: 'Score',
        cell: ({ getValue, row }) => (
          <div>
            <div className="font-medium text-foreground">
              {formatScoreToPar(getValue())}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {row.original.rounds.length} rounds, strokes {formatOptionalText(row.original.standing?.golf?.eventStrokes)}
            </div>
          </div>
        ),
      }),
      participantColumnHelper.accessor('updatedAt', {
        header: 'Updated',
        cell: ({ getValue }) => formatDateTimeDisplay(getValue()),
      }),
    ],
    [selectedSport, tierLabelById],
  );

  const selectedEvent = eventsQuery.data?.find((event) => event.id === selectedEventId);
  const participantModalTitle = selectedEvent?.name ?? 'Event participants';
  const participantModalDescription = selectedEvent
    ? `Participants from ${selectedEvent.providerId}`
    : 'Participants in this event.';

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
