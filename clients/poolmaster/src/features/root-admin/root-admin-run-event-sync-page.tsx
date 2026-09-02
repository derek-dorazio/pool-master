import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  adminListProviders,
  adminSyncProviderEventData,
  listEvents,
  type ListEventsResponses,
} from '@/lib/api';
import { getLogger } from '@/lib/logger';
import {
  Alert,
  Button,
  FormField,
  LinkButton,
  PageHeader,
  Select,
  Tile,
} from '@/features/shared/ui';
import {
  EVENT_SYNC_PRESETS,
  formatJsonPayload,
  getEventSyncPreset,
  getSupportedSyncSports,
  type EventSyncPresetId,
  type EventSyncSubmission,
  type ProviderSummary,
  type SyncSport,
} from './root-admin-sync-utils';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

type EventSyncEvent = ListEventsResponses[200]['events'][number];
type MockEventState = 'open' | 'locked' | 'live' | 'completed';

const MOCK_EVENT_STATE_OPTIONS: Array<{ value: MockEventState | ''; label: string }> = [
  { value: '', label: 'Use loaded event state' },
  { value: 'open', label: 'Open' },
  { value: 'locked', label: 'Locked' },
  { value: 'live', label: 'Live' },
  { value: 'completed', label: 'Completed' },
];

function getValidEventStatusesForPreset(
  presetId: EventSyncPresetId,
  hasMockEventStateOverride: boolean,
): EventSyncEvent['status'][] {
  if (hasMockEventStateOverride) {
    return ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'];
  }

  switch (presetId) {
    case 'EVENTLIVESCORES':
      return ['IN_PROGRESS'];
    case 'EVENTRESULTS':
      return ['COMPLETED'];
    case 'EVENTPARTICIPANTS':
      return ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'];
  }
}

function formatEventStartDate(startDate: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(startDate));
}

function formatEventOptionLabel(event: EventSyncEvent) {
  const participantText = typeof event.participantCount === 'number'
    ? `${event.participantCount} participants`
    : 'participants unknown';

  return [
    event.name,
    event.status,
    event.readinessStatus,
    formatEventStartDate(event.startDate),
    participantText,
    event.externalId,
  ].join(' · ');
}

export function RootAdminRunEventSyncPage() {
  const logger = getLogger().child({
    feature: 'root-admin-run-event-sync-page',
  });
  const [eventSyncSport, setEventSyncSport] = useState<SyncSport>('GOLF');
  const [eventSyncPresetId, setEventSyncPresetId] = useState<EventSyncPresetId>(
    'EVENTPARTICIPANTS',
  );
  const [selectedEventExternalId, setSelectedEventExternalId] = useState('');
  const [mockEventState, setMockEventState] = useState<MockEventState | ''>('');

  const providersQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.providers,
    queryFn: async (): Promise<ProviderSummary[]> => {
      const response = await adminListProviders();
      if (!response.data?.items) {
        throw response.error ?? new Error('Provider list response is missing data.');
      }
      return response.data.items;
    },
    retry: false,
  });

  const supportedSyncSports = useMemo(
    () => getSupportedSyncSports(providersQuery.data),
    [providersQuery.data],
  );
  const supportsMockEventState = useMemo(
    () =>
      eventSyncSport === 'GOLF'
      && (providersQuery.data ?? []).some((provider) =>
        provider.providerId === 'mock-contest-feed'
        && provider.sportsCovered.includes(eventSyncSport)),
    [eventSyncSport, providersQuery.data],
  );

  useEffect(() => {
    if (!supportedSyncSports.includes(eventSyncSport)) {
      const fallbackSport = supportedSyncSports[0];
      if (fallbackSport) {
        setEventSyncSport(fallbackSport);
      }
    }
  }, [eventSyncSport, supportedSyncSports]);

  useEffect(() => {
    if (!supportsMockEventState && mockEventState) {
      setMockEventState('');
    }
  }, [mockEventState, supportsMockEventState]);

  const eventsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.eventSyncEvents(eventSyncSport),
    queryFn: async (): Promise<EventSyncEvent[]> => {
      const response = await listEvents({
        query: {
          sport: eventSyncSport,
          limit: 100,
        },
      });

      if (!response.data?.events) {
        throw response.error ?? new Error('Event list response is missing data.');
      }

      return response.data.events;
    },
    enabled: supportedSyncSports.includes(eventSyncSport),
    retry: false,
  });

  const selectedPreset = getEventSyncPreset(eventSyncPresetId);
  const selectableEvents = useMemo(() => {
    const validStatuses = getValidEventStatusesForPreset(
      eventSyncPresetId,
      supportsMockEventState && mockEventState !== '',
    );
    return (eventsQuery.data ?? []).filter((event) =>
      validStatuses.includes(event.status),
    );
  }, [eventSyncPresetId, eventsQuery.data, mockEventState, supportsMockEventState]);
  const selectedEvent = selectableEvents.find((event) =>
    event.externalId === selectedEventExternalId,
  );

  useEffect(() => {
    if (
      selectedEventExternalId
      && !selectableEvents.some((event) => event.externalId === selectedEventExternalId)
    ) {
      setSelectedEventExternalId('');
    }
  }, [selectableEvents, selectedEventExternalId]);

  const eventSyncMutation = useInvalidatingMutation({
    mutationFn: async (input: {
      sport: SyncSport;
      eventId: string;
      presetId: EventSyncPresetId;
      mockEventState?: MockEventState;
    }): Promise<EventSyncSubmission> => {
      const preset = getEventSyncPreset(input.presetId);
      const response = await adminSyncProviderEventData({
        path: {
          sport: input.sport,
          eventId: input.eventId,
        },
        body: {
          feeds: [...preset.feeds],
          ...(input.mockEventState ? { mockEventState: input.mockEventState } : {}),
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Event sync response is missing the result payload.');
      }

      return response.data;
    },
    onMutate: (input) => {
      const preset = getEventSyncPreset(input.presetId);
      logger.debug(
        {
          action: 'rootAdmin.eventSync.started',
          data: {
            sport: input.sport,
            eventId: input.eventId,
            requestedFeeds: preset.feeds,
            mockEventState: input.mockEventState ?? null,
          },
        },
        'Starting manual provider event sync',
      );
    },
    onSuccess: async (result) => {
      logger.info(
        {
          action: 'rootAdmin.eventSync.submitted',
          data: {
            sport: result.sport,
            eventId: result.eventId,
            requestedFeeds: result.requestedFeeds,
            syncRunCount: result.syncRuns.length,
          },
        },
        'Submitted manual provider event sync',
      );
    },
    invalidates: [QueryKeys.rootAdmin.providerSyncRuns],
    onError: (error) => {
      if (error instanceof Error) {
        logger.error(
          {
            action: 'rootAdmin.eventSync.failed',
            data: {
              sport: eventSyncSport,
              eventId: selectedEventExternalId,
              mockEventState: mockEventState || null,
            },
            err: error,
          },
          'Manual provider event sync failed unexpectedly',
        );
        return;
      }

      logger.warn(
        {
          action: 'rootAdmin.eventSync.failed',
          data: {
            sport: eventSyncSport,
            eventId: selectedEventExternalId,
            mockEventState: mockEventState || null,
          },
        },
        'Manual provider event sync failed',
      );
    },
  });

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-run-event-sync-page"
    >
      <PageHeader
        actions={(
          <LinkButton
            to="/manage/sync"
            variant="subtle"
          >
            Back to Sync dashboard
          </LinkButton>
        )}
        description="Use this action when a specific event needs a targeted refresh for participants, live scores, or final results."
        eyebrow="Sync"
        title="Run event sync"
      />

      <Tile>
        <div className="space-y-3">
          <FormField label="Preset">
            <Select
              data-testid="root-admin-event-sync-preset"
              disabled={eventSyncMutation.isPending}
              onChange={(event) =>
                setEventSyncPresetId(event.target.value as EventSyncPresetId)}
              value={eventSyncPresetId}
            >
              {EVENT_SYNC_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Sport">
            <Select
              data-testid="root-admin-event-sync-sport"
              disabled={eventSyncMutation.isPending}
              onChange={(event) =>
                setEventSyncSport(event.target.value as SyncSport)}
              value={eventSyncSport}
            >
              {supportedSyncSports.map((sport) => (
                <option key={sport} value={sport}>
                  {sport}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Event">
            <Select
              data-testid="root-admin-event-sync-event-id"
              disabled={eventSyncMutation.isPending || eventsQuery.isLoading}
              onChange={(event) => setSelectedEventExternalId(event.target.value)}
              value={selectedEventExternalId}
            >
              <option value="">
                {eventsQuery.isLoading ? 'Loading events...' : 'Select a loaded event'}
              </option>
              {selectableEvents.map((event) => (
                <option key={event.id} value={event.externalId}>
                  {formatEventOptionLabel(event)}
                </option>
              ))}
            </Select>
          </FormField>

          {supportsMockEventState ? (
            <FormField label="Mock event state">
              <Select
                data-testid="root-admin-event-sync-mock-event-state"
                disabled={eventSyncMutation.isPending}
                onChange={(event) =>
                  setMockEventState(event.target.value as MockEventState | '')}
                value={mockEventState}
              >
                {MOCK_EVENT_STATE_OPTIONS.map((option) => (
                  <option key={option.value || 'loaded'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}

          <Tile radius="lg">
            <p className="font-medium text-foreground">Requested feeds</p>
            <p className="mt-2">{selectedPreset.feeds.join(' · ')}</p>
            {mockEventState ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Mock event state: {mockEventState}
              </p>
            ) : null}
          </Tile>

          {providersQuery.isError ? (
            <Alert>
              {extractErrorMessage(
                providersQuery.error,
                { fallback: 'Provider health context is unavailable, so the sport list is using fallback options.' },
              )}
            </Alert>
          ) : null}

          {eventsQuery.isError ? (
            <Alert>
              {extractErrorMessage(
                eventsQuery.error,
                { fallback: 'Loaded events are unavailable right now.' },
              )}
            </Alert>
          ) : null}

          {!eventsQuery.isLoading && !eventsQuery.isError && selectableEvents.length === 0 ? (
            <Alert>
              No loaded events match this sport and event-sync preset.
            </Alert>
          ) : null}

          <Button
            data-testid="root-admin-event-sync-now"
            disabled={eventSyncMutation.isPending || !selectedEvent}
            onClick={() =>
              selectedEvent
                ? eventSyncMutation.mutate({
                  sport: eventSyncSport,
                  eventId: selectedEvent.externalId,
                  presetId: eventSyncPresetId,
                  mockEventState: mockEventState || undefined,
                })
                : undefined}
          >
            {eventSyncMutation.isPending ? 'Syncing...' : 'Run event sync'}
          </Button>

          {eventSyncMutation.isError ? (
            <Alert tone="danger">
              {extractErrorMessage(
                eventSyncMutation.error,
                { fallback: 'We could not submit the event sync right now.' },
              )}
            </Alert>
          ) : null}

          {eventSyncMutation.isSuccess ? (
            <Tile data-testid="root-admin-event-sync-response" radius="lg">
              <p className="font-medium text-foreground">Latest API payload</p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs">
                {formatJsonPayload(eventSyncMutation.data)}
              </pre>
            </Tile>
          ) : null}
        </div>
      </Tile>
    </section>
  );
}
