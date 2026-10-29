import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SportEventSyncScope, getSportDefinition } from '@poolmaster/shared/domain';
import { linkEventScoreSource, listProviders, unlinkEventScoreSource } from '@/lib/api';
import {
  Button,
  ConfirmationModal,
  formatDateTimeDisplay,
  Heading,
  InlineError,
  PickerModal,
  StatusBadge,
  Tile,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  syncScopeLabel,
  syncScopeTone,
} from './sport-admin-utils';
import { GolfTournamentLiveSimulation } from './golf-tournament-live-simulation';
import {
  useProviderCatalog,
  type ProviderCatalogEvent,
} from './use-provider-catalog';
import type { SportEventDto } from '@/lib/api';
import { getScoringFamilyAdminUi } from './scoring-family-admin';

type PickerCatalogEvent = ProviderCatalogEvent & { id: string };

/**
 * #402 — a provider that can simulate live scoring (the QA mock feed) answers any event id
 * with this prefix as a golf event of its own, so a made-up tournament links to
 * `sandbox-<its id>` and never needs a real tournament's dates or id. The mock's
 * scenario-store.ts and core-api's mock adapter hold the same prefix.
 */
const simulatedEventIdPrefix = 'sandbox-';

/**
 * plans/124 §6.3 block 3 — the score-source link status plus the link picker and
 * unlink confirmation. The caller only renders this for an admin-managed event.
 */
export function SportEventScoreSourceCard({
  eventId,
  tournament,
}: {
  eventId: string;
  tournament: SportEventDto;
}) {
  const displayPreferences = useDisplayPreferences();
  const logger = getLogger().child({
    feature: 'root-admin-sport-event-home-page',
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const definition = getSportDefinition(tournament.sport);
  const { event: eventNoun } = definition.vocabulary;
  const resultsWord = getScoringFamilyAdminUi(tournament).resultsLabel.toLowerCase();

  const catalog = useProviderCatalog({
    enabled: linkOpen,
    sport: tournament.sport,
    from: tournament.startDate,
    to: tournament.endDate || undefined,
    search: catalogSearch,
  });
  const providerId = catalog.providerId;
  const pickerItems = useMemo<PickerCatalogEvent[]>(
    () => catalog.events.map((event) => ({ ...event, id: event.externalId })),
    [catalog.events],
  );

  const providersQuery = useQuery({
    enabled: tournament.syncScope === SportEventSyncScope.NONE,
    queryKey: QueryKeys.rootAdmin.providers,
    queryFn: async () => {
      const response = await listProviders();
      if (!response.data?.providers) {
        throwApiError(response.error, 'Provider list response is missing data.');
      }
      return response.data.providers;
    },
    retry: false,
  });
  // poolmaster-allow-list-lookup: the few data providers
  const simulatingProviderId = (providersQuery.data ?? []).find(
    (provider) => provider.sportsCovered.includes(tournament.sport) && provider.supportsLiveSimulation,
  )?.providerId ?? null;

  const linkMutation = useInvalidatingMutation({
    mutationFn: async (link: { providerId: string | null; externalId: string }) => {
      if (!link.providerId) {
        throw new Error(`No ${definition.name.toLowerCase()} provider is configured.`);
      }
      const response = await linkEventScoreSource({
        path: { eventId },
        body: { providerId: link.providerId, externalId: link.externalId },
      });
      if (!response.data?.event) {
        throwApiError(response.error, 'Score-source link response is missing data.');
      }
      return response.data.event;
    },
    invalidates: [
      QueryKeys.rootAdmin.manageSport.event(eventId),
      QueryKeys.rootAdmin.manageSport.events,
    ],
    onSuccess: () => {
      setLinkOpen(false);
      setSelectedCatalogId(null);
    },
    onError: (error) => {
      logger.warn(
        { action: 'event.score-source.link.failed', err: error },
        'Score-source link was rejected',
      );
    },
  });

  const unlinkMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await unlinkEventScoreSource({ path: { eventId } });
      if (!response.data?.event) {
        throwApiError(response.error, 'Score-source unlink response is missing data.');
      }
      return response.data.event;
    },
    invalidates: [
      QueryKeys.rootAdmin.manageSport.event(eventId),
      QueryKeys.rootAdmin.manageSport.events,
    ],
    onSuccess: () => setUnlinkOpen(false),
    onError: (error) => {
      logger.warn(
        { action: 'event.score-source.unlink.failed', err: error },
        'Score-source unlink was rejected',
      );
    },
  });

  return (
    <Tile>
      <Heading level={2} variant="card" size="lg">Score source</Heading>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <StatusBadge tone={syncScopeTone(tournament.syncScope)}>
          {syncScopeLabel(tournament.syncScope)}
        </StatusBadge>
        <p className="text-sm text-muted-foreground">
          {tournament.syncScope === SportEventSyncScope.NONE
            ? `Not linked — ${resultsWord} must be entered manually.`
            : `Linked to ${tournament.providerId} event ${tournament.externalId} — polled on the live-${resultsWord} sync cadence.`}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {tournament.syncScope === SportEventSyncScope.NONE ? (
          <>
            <Button
              data-testid="root-admin-sport-event-link-open"
              onClick={() => {
                // A refusal from the simulated-event link must not greet the picker.
                linkMutation.reset();
                setLinkOpen(true);
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              Link to provider event
            </Button>
            {simulatingProviderId ? (
              <Button
                data-testid="root-admin-sport-event-link-simulated"
                disabled={linkMutation.isPending}
                onClick={() =>
                  linkMutation.mutate({ providerId: simulatingProviderId, externalId: `${simulatedEventIdPrefix}${eventId}` })
                }
                size="sm"
                type="button"
                variant="secondary"
              >
                Link to a new simulated event
              </Button>
            ) : null}
          </>
        ) : (
          <Button
            data-testid="root-admin-sport-event-unlink-open"
            onClick={() => setUnlinkOpen(true)}
            size="sm"
            type="button"
            variant="secondary"
          >
            Unlink score source
          </Button>
        )}
      </div>
      {simulatingProviderId && tournament.syncScope === SportEventSyncScope.NONE ? (
        <p className="mt-2 text-sm text-muted-foreground">
          A simulated event works on any dates. After linking, load the participant field from it, then start the
          live simulation.
        </p>
      ) : null}
      {linkMutation.isError && !linkOpen ? (
        <InlineError className="mt-2" testId="root-admin-sport-event-link-error">
          {extractErrorMessage(linkMutation.error, { fallback: 'The link was rejected.' })}
        </InlineError>
      ) : null}
      {tournament.syncScope === SportEventSyncScope.NONE ? null : (
        <GolfTournamentLiveSimulation tournament={tournament} />
      )}

      <PickerModal<PickerCatalogEvent>
        canApply={selectedCatalogId !== null && !linkMutation.isPending}
        description={`Pick the provider event this ${eventNoun.one}'s live ${resultsWord} should come from.`}
        emptyMessage={
          catalog.isLoading
            ? 'Loading provider events...'
            : providerId === null
              ? `No provider is registered for ${definition.name.toLowerCase()}.`
              : `No provider events fall in this ${eventNoun.one}’s date window.`
        }
        errorMessage={
          linkMutation.isError
            ? extractErrorMessage(linkMutation.error, { fallback: 'The link was rejected.' })
            : undefined
        }
        getItemLabel={(item) => item.name}
        isPending={linkMutation.isPending}
        items={pickerItems}
        itemTestIdPrefix="root-admin-sport-event-link-option"
        onApply={() => selectedCatalogId && linkMutation.mutate({ providerId, externalId: selectedCatalogId })}
        onCancel={() => {
          setLinkOpen(false);
          setSelectedCatalogId(null);
        }}
        onOpenChange={(open) => {
          if (!open) {
            setLinkOpen(false);
            setSelectedCatalogId(null);
          }
        }}
        onSelect={(item) => setSelectedCatalogId(item.externalId)}
        open={linkOpen}
        renderItem={(item) => (
          <span>
            <span className="font-medium text-foreground">{item.name}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {formatDateTimeDisplay(item.startDate, displayPreferences)} – {formatDateTimeDisplay(item.endDate, displayPreferences)}
            </span>
          </span>
        )}
        search={{
          label: 'Search',
          onChange: setCatalogSearch,
          placeholder: 'Event name',
          value: catalogSearch,
        }}
        selectedId={selectedCatalogId}
        testId="root-admin-sport-event-link-modal"
        title="Link score source"
      />

      <ConfirmationModal
        confirmLabel="Unlink score source"
        confirmTestId="root-admin-sport-event-unlink-confirm"
        description="Scores already synced are kept. New scores will need to be entered manually."
        errorMessage={
          unlinkMutation.isError
            ? extractErrorMessage(unlinkMutation.error, {
                fallback: 'The unlink was rejected.',
              })
            : undefined
        }
        isPending={unlinkMutation.isPending}
        onCancel={() => setUnlinkOpen(false)}
        onConfirm={() => unlinkMutation.mutate()}
        onOpenChange={(open) => !open && setUnlinkOpen(false)}
        open={unlinkOpen}
        testId="root-admin-sport-event-unlink-modal"
        title="Unlink score source"
      />
    </Tile>
  );
}
