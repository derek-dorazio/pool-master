import { sportLeagueNounOf } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { createEventFromProviderEvent } from '@/lib/api';
import {
  Alert,
  Button,
  DateTimeField,
  dateTimeLocalValueToIso,
  formatDateTimeDisplay,
  FormField,
  InlineError,
  Input,
  QueryState,
  SectionCard,
  SectionNote,
  SectionRow,
  SectionRows,
  StatusBadge,
  toDateTimeLocalValue,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { SportLeagueDto } from '@/lib/api';
import { SportEventEditionFields } from './sport-event-edition-fields';
import {
  isCompleteEdition,
  parseEventYear,
  type SportEventEdition,
} from './sport-event-edition';
import {
  useProviderCatalog,
  type ProviderCatalogEvent,
} from './use-provider-catalog';
import { buildSportEventPath } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';
import { SportProviderChoice } from './sport-provider-choice';
import { upperFirst } from '@/lib/upper-first';


function defaultWindowValue(offsetDays: number, timeZone: string): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return toDateTimeLocalValue(date, timeZone);
}

export function SportEventProviderBrowse({
  edition,
  onEditionChange,
  sportLeagues,
}: {
  edition: SportEventEdition;
  onEditionChange: (edition: SportEventEdition) => void;
  sportLeagues: readonly SportLeagueDto[];
}) {
  const displayPreferences = useDisplayPreferences();
  const scopedSportLeague = sportLeagues.find((sportLeague) => sportLeague.id === edition.sportLeagueId);
  const logger = getLogger().child({
    feature: 'root-admin-sport-event-create-page',
  });
  const navigate = useNavigate();
  const { sport, definition } = useManagedSport();
  const { event: eventNoun, round } = definition.vocabulary;

  const [browseFrom, setBrowseFrom] = useState(() => defaultWindowValue(0, displayPreferences.timeZone));
  const [browseTo, setBrowseTo] = useState(() => defaultWindowValue(45, displayPreferences.timeZone));
  const [browseSearch, setBrowseSearch] = useState('');
  const [selectedEvent, setSelectedEvent] =
    useState<ProviderCatalogEvent | null>(null);
  const [providerRounds, setProviderRounds] = useState(() => String(definition.defaultRounds));

  const catalog = useProviderCatalog({
    enabled: true,
    sport,
    from: dateTimeLocalValueToIso(browseFrom, displayPreferences.timeZone),
    to: dateTimeLocalValueToIso(browseTo, displayPreferences.timeZone),
    sportLeagueId: scopedSportLeague?.id,
    search: browseSearch,
  });
  const providerId = catalog.providerId;

  const createMutation = useInvalidatingMutation({
    mutationFn: async () => {
      if (!providerId || !selectedEvent) {
        throw new Error('Select a provider event first.');
      }
      const roundsValue = Number.parseInt(providerRounds, 10);
      const response = await createEventFromProviderEvent({
        body: {
          sportLeagueId: edition.sportLeagueId,
          eventYear: parseEventYear(edition.eventYear) as number,
          providerId,
          externalId: selectedEvent.externalId,
          ...(Number.isNaN(roundsValue) ? {} : { rounds: roundsValue }),
        },
      });
      if (!response.data?.event.id) {
        throwApiError(response.error, `The ${eventNoun.one} creation response is missing data.`);
      }
      return response.data.event;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.events],
    onSuccess: (tournament) => {
      logger.info(
        { action: 'event.create.provider', data: { id: tournament.id } },
        'Created event from provider event',
      );
      void navigate(buildSportEventPath(sport, tournament.id));
    },
    onError: (error) => {
      logger.warn(
        { action: 'event.create.provider.failed', err: error },
        'Provider event creation was rejected',
      );
    },
  });

  return (
    <div className="space-y-4">
      {catalog.providersError || (catalog.providersLoaded && providerId === null) ? (
        <Alert tone="warning">
          No provider is registered for {definition.name.toLowerCase()}, so there is no catalog
          to browse. Build the {eventNoun.one} manually instead.
        </Alert>
      ) : null}

      {!selectedEvent ? (
        <SectionCard padded title="Provider events">
          <SportProviderChoice
            onChange={catalog.setProviderId}
            providerId={providerId}
            providers={catalog.providers}
            testId="root-admin-sport-event-create-provider"
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="From">
              <DateTimeField
                onChange={(event) => setBrowseFrom(event.target.value)}
                value={browseFrom}
              />
            </FormField>
            <FormField label="To">
              <DateTimeField
                onChange={(event) => setBrowseTo(event.target.value)}
                value={browseTo}
              />
            </FormField>
            <FormField label="Search">
              <Input
                onChange={(event) => setBrowseSearch(event.target.value)}
                placeholder="Event name"
                type="search"
                value={browseSearch}
              />
            </FormField>
          </div>

          {scopedSportLeague ? (
            <SectionNote>{`Filtered to ${scopedSportLeague.name}.`}</SectionNote>
          ) : null}

          <div
            className="mt-4"
            data-testid="root-admin-sport-event-create-catalog"
          >
            <QueryState
              empty="No provider events fall in this window."
              error={extractErrorMessage(catalog.error, {
                fallback: 'We could not load the provider catalog.',
              })}
              isEmpty={(events) => events.length === 0}
              loading="Loading provider events..."
              query={{ data: catalog.isLoading ? undefined : catalog.events, isError: catalog.isError }}
            >
              {(events) => (
                <SectionRows>
                  {events.map((event) => (
                  <SectionRow
                      aside={(
                        <Button
                          data-testid={`root-admin-sport-event-create-select-${event.externalId}`}
                          onClick={() => setSelectedEvent(event)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Select
                        </Button>
                      )}
                      facts={`${formatDateTimeDisplay(event.startDate, displayPreferences)} – ${formatDateTimeDisplay(event.endDate, displayPreferences)} · ${event.status}`}
                      key={event.externalId}
                      name={event.name}
                    />
                  ))}
                </SectionRows>
              )}
            </QueryState>
          </div>
        </SectionCard>
      ) : (
        <SectionCard
          padded
          title={selectedEvent.name}
          trailing={(
            <>
              <StatusBadge tone="info">Provider event</StatusBadge>
              <Button onClick={() => setSelectedEvent(null)} size="sm" type="button" variant="ghost">
                Change
              </Button>
            </>
          )}
        >
          <div className="space-y-4">
            <SectionNote>
              {`${formatDateTimeDisplay(selectedEvent.startDate, displayPreferences)} – ${formatDateTimeDisplay(selectedEvent.endDate, displayPreferences)}`}
            </SectionNote>
            <div className="grid gap-4 sm:grid-cols-2">
              <SportEventEditionFields edition={edition} onChange={onEditionChange} sportLeagues={sportLeagues} />
              <FormField
                helperText={`The provider doesn't report a ${round.one} count; adjust per-${round.one} dates later.`}
                label={upperFirst(round.many)}
              >
                <Input
                  data-testid="root-admin-sport-event-create-provider-rounds"
                  min={1}
                  onChange={(event) => setProviderRounds(event.target.value)}
                  type="number"
                  value={providerRounds}
                />
              </FormField>
            </div>

            <Alert tone="info">
              The field is not imported now. After creating, open the {eventNoun.one} and use
              Load Participant Field.
            </Alert>

            <div className="flex justify-end">
              <Button
                data-testid="root-admin-sport-event-create-provider-submit"
                disabled={!isCompleteEdition(edition) || createMutation.isPending}
                isLoading={createMutation.isPending}
                onClick={() => createMutation.mutate()}
                type="button"
              >
                Create linked {eventNoun.one}
              </Button>
            </div>

            {createMutation.isError ? (
              <InlineError>
                {extractErrorMessage(createMutation.error, {
                  codeMessages: {
                    EVENT_EDITION_ALREADY_EXISTS: `This ${sportLeagueNounOf(sport, scopedSportLeague?.noun ?? null).one} already has a ${edition.eventYear} edition of this ${eventNoun.one}.`,
                  },
                  fallback: `We could not create this ${eventNoun.one}.`,
                })}
              </InlineError>
            ) : null}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
