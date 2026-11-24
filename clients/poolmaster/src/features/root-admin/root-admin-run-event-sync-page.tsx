import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSportDefinition, SportEventSyncScope } from '@poolmaster/shared/domain';
import { submitEventSync, listEvents, type SportEventDto } from '@/lib/api';
import { getLogger } from '@/lib/logger';
import {
  Notice,
  Button,
  formatDateTimeDisplay,
  FormField,
  HelpTip,
  PageHeader,
  SectionCard,
  SectionNote,
  Select,
  type DisplayPreferences,
  useDisplayPreferences,
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
import { useProvidersQuery } from './use-providers-query';

function getValidEventStatusesForPreset(presetId: EventSyncPresetId): SportEventDto['status'][] {
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

  const providersQuery = useProvidersQuery();

  const supportedSyncSports = useMemo(
    () => getSupportedSyncSports(providersQuery.data),
    [providersQuery.data],
  );
  // A sport no provider syncs falls back to the first one that does.
  const eventSyncSport = supportedSyncSports.includes(chosenSyncSport)
    ? chosenSyncSport
    : supportedSyncSports.at(0) ?? chosenSyncSport;

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
    const validStatuses = getValidEventStatusesForPreset(eventSyncPresetId);
    // Only an event linked to a provider event can sync; the server refuses an unlinked one.
    return (eventsQuery.data ?? []).filter((event) =>
      event.syncScope !== SportEventSyncScope.NONE
      && validStatuses.includes(event.status),
    );
  }, [eventSyncPresetId, eventsQuery.data]);
  // Events are chosen by id: two providers' events can share an external id.
  const selectedEvent = selectableEvents.find((event) => event.id === chosenEventId);
  // An event the sport, year or preset rules out is no longer selected.
  const selectedEventId = selectedEvent ? chosenEventId : '';

  const eventSyncMutation = useInvalidatingMutation({
    mutationFn: async (input: {
      sport: SyncSport;
      providerId: string;
      eventId: string;
      presetId: EventSyncPresetId;
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
    invalidates: [QueryKeys.rootAdmin.activity, QueryKeys.rootAdmin.providerSyncRuns],
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
        testId="root-admin-run-event-sync-header"
        title="Run event sync"
        titleAside={(
          <HelpTip label="About running an event sync" testId="root-admin-run-event-sync-help">
            Use this action when a linked event needs a targeted refresh of its field or live
            scores.
          </HelpTip>
        )}
      />

      <SectionCard padded title="Event to sync">
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

          <SectionNote>
            {`Requested feeds: ${selectedPreset.feeds.map((feed) => FEED_LABELS[feed]).join(' · ')}`}
          </SectionNote>

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
        </div>
      </SectionCard>

      {eventSyncMutation.isSuccess ? (
        <SectionCard padded testId="root-admin-event-sync-response" title="Latest API payload">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
            {formatJsonPayload(eventSyncMutation.data)}
          </pre>
        </SectionCard>
      ) : null}
    </section>
  );
}
