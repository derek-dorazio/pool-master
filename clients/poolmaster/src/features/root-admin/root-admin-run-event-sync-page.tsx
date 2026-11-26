import { enumLabel } from '@poolmaster/shared/display-strings';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  syncedSports,
  type EventSyncPresetId,
  type EventSyncSubmission,
} from './root-admin-sync-utils';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { SeasonSelect } from './season-select';
import { useSportLeaguesQuery } from './use-sport-catalog';
import { seasonIdOrCurrent, useSportLeagueSeasonsQuery } from '@/features/contests/use-sport-league-seasons';
import { useSportLeagueOverviewsQuery } from './use-sport-league-overviews';
import type { Sport } from '@poolmaster/shared/domain';

function getValidEventStatusesForPreset(presetId: EventSyncPresetId): SportEventDto['status'][] {
  switch (presetId) {
    case 'EVENTLIVESCORES':
      return ['IN_PROGRESS'];
    case 'EVENTPARTICIPANTS':
      return ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'];
  }
}

function formatEventOptionLabel(event: SportEventDto, displayPreferences: DisplayPreferences) {
  const participantText = `${event.participantCount} participants`;

  return [
    event.name,
    event.status,
    event.readinessStatus,
    formatDateTimeDisplay(event.startDate, displayPreferences),
    participantText,
    ...event.providerMappings.map((mapping) => mapping.externalId),
  ].join(' · ');
}

export function RootAdminRunEventSyncPage() {
  const displayPreferences = useDisplayPreferences();
  const logger = getLogger().child({
    feature: 'root-admin-run-event-sync-page',
  });
  // The viewer's choices; the values the page uses fall back while a choice is not available.
  const [chosenSyncSport, setEventSyncSport] = useState<Sport | null>(null);
  const [eventSyncPresetId, setEventSyncPresetId] = useState<EventSyncPresetId>(
    'EVENTPARTICIPANTS',
  );
  const [chosenSportLeagueId, setChosenSportLeagueId] = useState<string | null>(null);
  const [chosenSeasonId, setChosenSeasonId] = useState<string | null>(null);
  const [chosenEventId, setChosenEventId] = useState('');

  const leagueOverviewsQuery = useSportLeagueOverviewsQuery();

  // The sports a provider syncs an active league of (#2073), read from the leagues' own sync.
  const supportedSyncSports = useMemo(
    () => syncedSports(leagueOverviewsQuery.data),
    [leagueOverviewsQuery.data],
  );
  // Until the viewer picks one, or once their pick is not synced, the first synced sport.
  const eventSyncSport = chosenSyncSport !== null && supportedSyncSports.includes(chosenSyncSport)
    ? chosenSyncSport
    : supportedSyncSports.at(0);

  // The events are one Season's (#2003): a sport league, then its Season, opening on the first
  // league and its current Season.
  const sportLeaguesQuery = useSportLeaguesQuery(eventSyncSport);
  const sportLeagues = sportLeaguesQuery.data ?? [];
  // poolmaster-allow-list-lookup: sport leagues are reference data, a few dozen rows that do not grow with history
  const sportLeague = sportLeagues.find((league) => league.id === chosenSportLeagueId) ?? sportLeagues.at(0);
  const seasonsQuery = useSportLeagueSeasonsQuery(sportLeague?.id ?? '');
  // poolmaster-allow-list-lookup: a league's Seasons, a handful of rows
  const chosenSeason = seasonsQuery.data?.find((season) => season.id === chosenSeasonId);
  const seasonId = seasonIdOrCurrent(chosenSeason?.id ?? null, sportLeague);

  const eventsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.eventSyncEvents(seasonId),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({ query: { sportLeagueSeasonId: seasonId ?? undefined } });

      if (!response.data?.events) {
        throwApiError(response.error, 'Event list response is missing data.');
      }

      return response.data.events;
    },
    enabled: eventSyncSport !== undefined && seasonId !== null,
    retry: false,
  });

  const selectedPreset = getEventSyncPreset(eventSyncPresetId);
  const selectableEvents = useMemo(() => {
    const validStatuses = getValidEventStatusesForPreset(eventSyncPresetId);
    // Only an event its league's provider syncs can sync; the server refuses a test event.
    return (eventsQuery.data ?? []).filter((event) => !event.isTestData && validStatuses.includes(event.status));
  }, [eventSyncPresetId, eventsQuery.data]);
  // Events are chosen by id: two providers' events can share an external id.
  const selectedEvent = selectableEvents.find((event) => event.id === chosenEventId);
  // An event the sport, Season or preset rules out is no longer selected.
  const selectedEventId = selectedEvent ? chosenEventId : '';

  const eventSyncMutation = useInvalidatingMutation({
    mutationFn: async (input: {
      eventId: string;
      presetId: EventSyncPresetId;
    }): Promise<EventSyncSubmission> => {
      const preset = getEventSyncPreset(input.presetId);
      const response = await submitEventSync({
        path: { eventId: input.eventId },
        body: { feeds: [...preset.feeds] },
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
            sport: eventSyncSport ?? null,
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
              sport: eventSyncSport ?? null,
              eventId: selectedEvent?.id ?? null,
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
            sport: eventSyncSport ?? null,
            eventId: selectedEvent?.id ?? null,
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
            Use this action when a synced event needs a targeted refresh of its field or live
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
                setEventSyncSport(event.target.value as Sport)}
              value={eventSyncSport ?? ''}
            >
              {supportedSyncSports.map((sport) => (
                <option key={sport} value={sport}>
                  {enumLabel('Sport', sport)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Sport league">
            <Select
              data-testid="root-admin-event-sync-sport-league"
              disabled={eventSyncMutation.isPending || sportLeagues.length === 0}
              onChange={(event) => {
                setChosenSportLeagueId(event.target.value);
                setChosenSeasonId(null);
              }}
              value={sportLeague?.id ?? ''}
            >
              {sportLeagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.name}
                </option>
              ))}
            </Select>
          </FormField>

          {seasonsQuery.data && seasonId !== null ? (
            <SeasonSelect onChange={setChosenSeasonId} seasons={seasonsQuery.data} testId="root-admin-event-sync-season" value={seasonId} />
          ) : null}

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

          {leagueOverviewsQuery.isError ? (
            <Notice>
              {extractErrorMessage(
                leagueOverviewsQuery.error,
                { fallback: 'The sport leagues could not be loaded, so no sport can be picked.' },
              )}
            </Notice>
          ) : null}

          {leagueOverviewsQuery.isSuccess && supportedSyncSports.length === 0 ? (
            <Notice>No active sport league is synced from a provider, so there is nothing to sync.</Notice>
          ) : null}

          {eventsQuery.isError ? (
            <Notice>
              {extractErrorMessage(
                eventsQuery.error,
                { fallback: 'Loaded events are unavailable right now.' },
              )}
            </Notice>
          ) : null}

          {eventSyncSport !== undefined && !eventsQuery.isLoading && !eventsQuery.isError && selectableEvents.length === 0 ? (
            <Notice>
              No synced {enumLabel('Sport', eventSyncSport).toLowerCase()} events match this preset. A test event has
              nothing to sync.
            </Notice>
          ) : null}

          <Button
            data-testid="root-admin-event-sync-now"
            disabled={eventSyncMutation.isPending || !selectedEvent}
            onClick={() =>
              selectedEvent
                ? eventSyncMutation.mutate({
                  eventId: selectedEvent.id,
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
