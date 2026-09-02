import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminCreateGolfTournamentFromProviderEvent } from '@/lib/api';
import {
  Alert,
  Button,
  DateTimeField,
  FormField,
  Input,
  StatusBadge,
  Tile,
  formatDateTimeDisplay,
  toDateTimeLocalValue,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminListGolfSeasonsResponses } from '@/lib/api';
import { GolfTournamentSeasonSelect } from './golf-tournament-season-select';
import { localDateTimeInputToIso } from './golf-admin-utils';
import {
  useGolfProviderCatalog,
  type GolfProviderCatalogEvent,
} from './use-golf-provider-catalog';

type GolfSeason = AdminListGolfSeasonsResponses[200]['seasons'][number];

function defaultWindowValue(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return toDateTimeLocalValue(date);
}

export function GolfTournamentProviderBrowse({
  onSeasonChange,
  scopedSeason,
  seasonId,
  seasons,
}: {
  onSeasonChange: (seasonId: string) => void;
  scopedSeason: GolfSeason | undefined;
  seasonId: string;
  seasons: readonly GolfSeason[];
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-create-page',
  });
  const navigate = useNavigate();

  const [browseFrom, setBrowseFrom] = useState(() => defaultWindowValue(0));
  const [browseTo, setBrowseTo] = useState(() => defaultWindowValue(45));
  const [browseSearch, setBrowseSearch] = useState('');
  const [selectedEvent, setSelectedEvent] =
    useState<GolfProviderCatalogEvent | null>(null);
  const [providerRounds, setProviderRounds] = useState('4');

  const catalog = useGolfProviderCatalog({
    enabled: true,
    from: localDateTimeInputToIso(browseFrom),
    to: localDateTimeInputToIso(browseTo),
    sportLeagueId: scopedSeason?.sportLeagueId,
    search: browseSearch,
  });
  const providerId = catalog.providerId;

  const createMutation = useInvalidatingMutation({
    mutationFn: async () => {
      if (!providerId || !selectedEvent) {
        throw new Error('Select a provider event first.');
      }
      const roundsValue = Number.parseInt(providerRounds, 10);
      const response = await adminCreateGolfTournamentFromProviderEvent({
        body: {
          seasonId,
          providerId,
          externalId: selectedEvent.externalId,
          ...(Number.isNaN(roundsValue) ? {} : { rounds: roundsValue }),
        },
      });
      if (!response.data?.tournament?.id) {
        throw response.error ?? new Error('Tournament creation response is missing data.');
      }
      return response.data.tournament;
    },
    invalidates: [QueryKeys.rootAdmin.golf.tournaments],
    onSuccess: (tournament) => {
      logger.info(
        { action: 'golf.tournament.create.provider', data: { id: tournament.id } },
        'Created golf tournament from provider event',
      );
      navigate(`/manage/golf/tournaments/${tournament.id}`);
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.tournament.create.provider.failed', err: error },
        'Provider golf tournament creation was rejected',
      );
    },
  });

  return (
    <div className="space-y-4">
      {catalog.providersError || (catalog.providersLoaded && providerId === null) ? (
        <Alert tone="warning">
          No provider is registered for golf, so there is no catalog to browse. Build the
          tournament manually instead.
        </Alert>
      ) : null}

      {!selectedEvent ? (
        <Tile>
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

          {scopedSeason?.sportLeagueId ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Filtered to {scopedSeason.name}&rsquo;s tour.
            </p>
          ) : null}

          <div
            className="mt-4 space-y-2"
            data-testid="root-admin-golf-tournament-create-catalog"
          >
            {catalog.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading provider events...</p>
            ) : catalog.isError ? (
              <p className="text-sm text-destructive">
                {extractErrorMessage(catalog.error, {
                  fallback: 'We could not load the provider catalog.',
                })}
              </p>
            ) : catalog.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No provider events fall in this window.
              </p>
            ) : (
              catalog.events.map((event) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3"
                  key={event.externalId}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{event.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatDateTimeDisplay(event.startDate)} &ndash;{' '}
                      {formatDateTimeDisplay(event.endDate)} · {event.status}
                    </div>
                  </div>
                  <Button
                    data-testid={`root-admin-golf-tournament-create-select-${event.externalId}`}
                    onClick={() => setSelectedEvent(event)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Select
                  </Button>
                </div>
              ))
            )}
          </div>
        </Tile>
      ) : (
        <Tile>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <StatusBadge tone="info">Provider event</StatusBadge>
                <div className="mt-2 font-medium text-foreground">
                  {selectedEvent.name}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDateTimeDisplay(selectedEvent.startDate)} &ndash;{' '}
                  {formatDateTimeDisplay(selectedEvent.endDate)}
                </div>
              </div>
              <Button
                onClick={() => setSelectedEvent(null)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Change
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <GolfTournamentSeasonSelect
                onChange={onSeasonChange}
                seasons={seasons}
                value={seasonId}
              />
              <FormField
                helperText="The provider contract has no round count; adjust per-round dates later."
                label="Rounds"
              >
                <Input
                  data-testid="root-admin-golf-tournament-create-provider-rounds"
                  min={1}
                  onChange={(event) => setProviderRounds(event.target.value)}
                  type="number"
                  value={providerRounds}
                />
              </FormField>
            </div>

            <Alert tone="info">
              The field is not imported now. After creating, open the tournament and use
              Load Participant Field.
            </Alert>

            <div className="flex justify-end">
              <Button
                data-testid="root-admin-golf-tournament-create-provider-submit"
                disabled={seasonId === '' || createMutation.isPending}
                isLoading={createMutation.isPending}
                onClick={() => createMutation.mutate()}
                type="button"
              >
                Create linked tournament
              </Button>
            </div>

            {createMutation.isError ? (
              <p className="text-sm font-medium text-destructive">
                {extractErrorMessage(createMutation.error, {
                  fallback: 'We could not create this tournament.',
                })}
              </p>
            ) : null}
          </div>
        </Tile>
      )}
    </div>
  );
}
