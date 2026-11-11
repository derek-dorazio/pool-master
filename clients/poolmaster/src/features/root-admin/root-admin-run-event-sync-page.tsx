import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSportDefinition, SportEventSyncScope } from '@poolmaster/shared/domain';
import { submitEventSync, listEvents, type SportEventDto } from '@/lib/api';
import { getLogger } from '@/lib/logger';
import {
  Notice,
  Button,
  FormField,
  Select,
  Tile,
  formatDateTimeDisplay,
  useDisplayPreferences,
  type DisplayPreferences,
} from '@/features/shared/ui';
import {
  EVENT_SYNC_PRESETS,
  FEED_LABELS,
  formatJsonPayload,
  getEventSyncPreset,
  getSupportedSyncSports,
  type EventSyncPresetId,
  type EventSyncSubmission,
  type SyncSport,
} from './root-admin-sync-utils';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { EventYearSelect } from './event-year-select';
import { ManagePageIntro } from './manage-page-intro';
import { useProvidersQuery } from './use-providers-query';

type MockEventState = 'open' | 'locked' | 'live' | 'completed';

/** The QA mock feed, the one provider that takes a mock event state. */

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
): SportEventDto['status'][] {
  if (hasMockEventStateOverride) {
    return ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'];
  }

  switch (presetId) {
    case 'EVENTLIVESCORES':
      return ['IN_PROGRESS'];
    case 'EVENTPARTICIPANTS':
      return ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'];
  }
}

function formatEventOptionLabel(event: SportEventDto, displayPreferences: DisplayPreferences) {
  const participantText = typeof event.participantCount === 'number'
    ? `${event.participantCount} participants`
    : 'participants unknown';

  return [
    event.name,
    event.status,
    event.readinessStatus,
    formatDateTimeDisplay(event.startDate, displayPreferences),
    participantText,
    event.externalId,
  ].join(' · ');
}

export function RootAdminRunEventSyncPage() {
  const displayPreferences = useDisplayPreferences();
  const logger = getLogger().child({
    feature: 'root-admin-run-event-sync-page',
  });
  // The viewer's choices; the values the page uses fall back while a choice is not available.
  const [chosenSyncSport, setEventSyncSport] = useState<SyncSport>('GOLF');
  const [eventSyncPresetId, setEventSyncPresetId] = useState<EventSyncPresetId>(
    'EVENTPARTICIPANTS',
  );
  const [eventYear, setEventYear] = useState(() => new Date().getFullYear());
  const [chosenEventId, setChosenEventId] = useState('');
  const [chosenMockEventState, setMockEventState] = useState<MockEventState | ''>('');

  const providersQuery = useProvidersQuery();

  const supportedSyncSports = useMemo(
    () => getSupportedSyncSports(providersQuery.data),
    [providersQuery.data],
  );
  // A sport no provider syncs falls back to the first one that does.
  const eventSyncSport = supportedSyncSports.includes(chosenSyncSport)
    ? chosenSyncSport
    : supportedSyncSports.at(0) ?? chosenSyncSport;
  // The providers that can play a mock event state for the sport: those reporting live simulation.
  const mockStateProviderIds = useMemo(
    () => new Set(
      (providersQuery.data ?? [])
        .filter((provider) => provider.supportsLiveSimulation && provider.sportsCovered.includes(eventSyncSport))
        .map((provider) => provider.providerId),
    ),
    [eventSyncSport, providersQuery.data],
  );
  const supportsMockEventState = mockStateProviderIds.size > 0;

  // A mock state applies only while the mock feed covers the sport.
  const mockEventState = supportsMockEventState ? chosenMockEventState : '';

  const eventsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.eventSyncEvents(eventSyncSport, eventYear),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({
        query: {
          sport: eventSyncSport,
          eventYear,
        },
      });

      if (!response.data?.events) {
        throwApiError(response.error, 'Event list response is missing data.');
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
    // Only an event linked to a provider event can sync; the server refuses an unlinked one.
    // A mock state drives only the mock feed, so it narrows the list to the mock's events (#1495).
    return (eventsQuery.data ?? []).filter((event) =>
      event.syncScope !== SportEventSyncScope.NONE
      && validStatuses.includes(event.status)
      && (mockEventState === '' || mockStateProviderIds.has(event.providerId)),
    );
  }, [eventSyncPresetId, eventsQuery.data, mockEventState, mockStateProviderIds, supportsMockEventState]);
  // Events are chosen by id: two providers' events can share an external id.
  const selectedEvent = selectableEvents.find((event) => event.id === chosenEventId);
  // An event the sport, year, preset or mock state rules out is no longer selected.
  const selectedEventId = selectedEvent ? chosenEventId : '';

  const eventSyncMutation = useInvalidatingMutation({
    mutationFn: async (input: {
      sport: SyncSport;
      providerId: string;
      eventId: string;
      presetId: EventSyncPresetId;
      mockEventState?: MockEventState;
    }): Promise<EventSyncSubmission> => {
      const preset = getEventSyncPreset(input.presetId);
      const response = await submitEventSync({
        path: {
          sport: input.sport,
          eventId: input.eventId,
        },
        body: {
          providerId: input.providerId,
          feeds: [...preset.feeds],
          ...(input.mockEventState ? { mockEventState: input.mockEventState } : {}),
        },
      });

      if (!response.data) {
        throwApiError(response.error, 'Event sync response is missing the result payload.');
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
    onSuccess: (result) => {
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
      // ApiError wraps every SDK rejection (see throwApiError) so it is
      // always `instanceof Error`; check for it explicitly rather than
      // `error instanceof Error` to keep distinguishing an expected API
      // rejection from a genuine unexpected exception.
      if (!(error instanceof ApiError)) {
        logger.error(
          {
            action: 'rootAdmin.eventSync.failed',
            data: {
              sport: eventSyncSport,
              providerId: selectedEvent?.providerId ?? null,
            eventId: selectedEvent?.externalId ?? null,
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
            providerId: selectedEvent?.providerId ?? null,
              eventId: selectedEvent?.externalId ?? null,
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
      <ManagePageIntro>
        Use this action when a linked event needs a targeted refresh of its field or live scores.
      </ManagePageIntro>

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
                  {getSportDefinition(sport).name}
                </option>
              ))}
            </Select>
          </FormField>

          <EventYearSelect onChange={setEventYear} testId="root-admin-event-sync-year" value={eventYear} />

          <FormField label="Event">
            <Select
              data-testid="root-admin-event-sync-event-id"
              disabled={eventSyncMutation.isPending || eventsQuery.isLoading}
              onChange={(event) => setChosenEventId(event.target.value)}
              value={selectedEventId}
            >
              <option value="">
                {eventsQuery.isLoading ? 'Loading events...' : 'Select a loaded event'}
              </option>
              {selectableEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {formatEventOptionLabel(event, displayPreferences)}
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
            <p className="mt-2">{selectedPreset.feeds.map((feed) => FEED_LABELS[feed]).join(' · ')}</p>
            {mockEventState ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Mock event state: {mockEventState}
              </p>
            ) : null}
          </Tile>

          {providersQuery.isError ? (
            <Notice>
              {extractErrorMessage(
                providersQuery.error,
                { fallback: 'Provider health context is unavailable, so the sport list is using fallback options.' },
              )}
            </Notice>
          ) : null}

          {eventsQuery.isError ? (
            <Notice>
              {extractErrorMessage(
                eventsQuery.error,
                { fallback: 'Loaded events are unavailable right now.' },
              )}
            </Notice>
          ) : null}

          {!eventsQuery.isLoading && !eventsQuery.isError && selectableEvents.length === 0 ? (
            <Notice>
              No linked {getSportDefinition(eventSyncSport).name.toLowerCase()} events match this preset. Link an event to a score
              source on its page first; an unlinked event has nothing to sync.
            </Notice>
          ) : null}

          <Button
            data-testid="root-admin-event-sync-now"
            disabled={eventSyncMutation.isPending || !selectedEvent}
            onClick={() =>
              selectedEvent
                ? eventSyncMutation.mutate({
                  sport: eventSyncSport,
                  providerId: selectedEvent.providerId,
                  eventId: selectedEvent.externalId,
                  presetId: eventSyncPresetId,
                  mockEventState: mockEventState || undefined,
                })
                : undefined}
          >
            {eventSyncMutation.isPending ? 'Syncing...' : 'Run event sync'}
          </Button>

          {eventSyncMutation.isError ? (
            <Notice tone="danger">
              {extractErrorMessage(
                eventSyncMutation.error,
                { fallback: 'We could not submit the event sync right now.' },
              )}
            </Notice>
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
