import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import {
  bindParticipantProviderMapping,
  listParticipants,
  listSports,
  listUnmappedProviderParticipants,
  type UnmappedProviderParticipantDto,
} from '@/lib/api';
import {
  Button,
  DataGridPage,
  FormField,
  FormModal,
  Input,
  LinkButton,
  PageHeader,
  Select,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';

const columnHelper = createColumnHelper<UnmappedProviderParticipantDto>();

function rowKey(row: UnmappedProviderParticipantDto): string {
  return `${row.providerId}:${row.externalId}`;
}

/**
 * #205 — /manage/sync/unmapped-participants. A competitor a provider reports that no
 * participant is mapped to has nowhere for their synced scores to land, so the leaderboard
 * is quietly wrong rather than visibly broken. This lists them and binds each one to a
 * participant of the same sport.
 */
export function RootAdminUnmappedParticipantsPage() {
  const [mapping, setMapping] = useState<UnmappedProviderParticipantDto | null>(null);

  const unmappedQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.unmappedProviderParticipants,
    queryFn: async (): Promise<UnmappedProviderParticipantDto[]> => {
      const response = await listUnmappedProviderParticipants();
      if (!response.data?.participants) {
        throwApiError(response.error, 'Unmapped competitor response is missing data.');
      }
      return response.data.participants;
    },
    retry: false,
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('externalName', {
        header: 'Competitor',
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('sport', { header: 'Sport' }),
      columnHelper.accessor('providerName', { header: 'Provider' }),
      columnHelper.accessor('externalId', { header: 'Provider id' }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            data-testid={`root-admin-unmapped-participant-map-${rowKey(row.original)}`}
            onClick={() => setMapping(row.original)}
            variant="secondary"
          >
            Map
          </Button>
        ),
      }),
    ],
    [],
  );

  return (
    <section className="space-y-6" data-testid="root-admin-unmapped-participants-page">
      <PageHeader
        actions={(
          <LinkButton to="/manage/sync" variant="subtle">
            Back to Sync dashboard
          </LinkButton>
        )}
        description="Competitors a provider reports that no participant is mapped to. Their synced scores have nowhere to land until you bind each one to a participant."
        eyebrow="Sync"
        title="Unmapped competitors"
      />

      <DataGridPage
        columns={columns}
        data={unmappedQuery.data ?? []}
        emptyMessage="Every competitor the providers report is mapped to a participant."
        errorBody={extractErrorMessage(unmappedQuery.error, {
          fallback: 'We could not load unmapped competitors right now.',
        })}
        filterTestIdPrefix="root-admin-unmapped-participants-filter"
        getRowId={rowKey}
        loadingBody="Loading unmapped competitors..."
        rowTestId={(row) => `root-admin-unmapped-participant-row-${rowKey(row)}`}
        state={unmappedQuery.isLoading ? 'loading' : unmappedQuery.isError ? 'error' : 'ready'}
        tableTestId="root-admin-unmapped-participants-table"
        testId="root-admin-unmapped-participants-grid"
      />

      {mapping ? (
        <MapCompetitorModal competitor={mapping} key={rowKey(mapping)} onClose={() => setMapping(null)} />
      ) : null}
    </section>
  );
}

function MapCompetitorModal({
  competitor,
  onClose,
}: {
  competitor: UnmappedProviderParticipantDto;
  onClose: () => void;
}) {
  const logger = getLogger().child({ feature: 'root-admin-unmapped-participants-page' });
  // Seeded from the provider's spelling once per competitor (the modal is keyed on it).
  const [search, setSearch] = useState(competitor.externalName);
  const [participantId, setParticipantId] = useState('');
  const trimmedSearch = search.trim();

  const sportQuery = useQuery({
    queryKey: QueryKeys.sports.list,
    queryFn: async () => {
      const response = await listSports();
      if (!response.data?.sports) {
        throwApiError(response.error, 'Sport list response is missing data.');
      }
      return response.data.sports;
    },
    staleTime: Infinity,
    retry: false,
  });
  const sportId = sportQuery.data?.find((sport) => sport.name === competitor.sport)?.id ?? null;

  const candidatesQuery = useQuery({
    enabled: sportId !== null && trimmedSearch.length > 0,
    queryKey: QueryKeys.rootAdmin.participantCandidates(sportId, trimmedSearch),
    queryFn: async () => {
      const response = await listParticipants({ query: { sportId: sportId ?? undefined, q: trimmedSearch } });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Participant search response is missing data.');
      }
      return response.data.participants;
    },
    retry: false,
  });
  const candidates = candidatesQuery.data ?? [];

  const bindMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await bindParticipantProviderMapping({
        path: { id: participantId },
        body: { providerId: competitor.providerId, externalId: competitor.externalId },
      });
      if (!response.data?.providerMapping) {
        throwApiError(response.error, 'Provider mapping response is missing data.');
      }
      return response.data.providerMapping;
    },
    invalidates: [QueryKeys.rootAdmin.unmappedProviderParticipants],
    onSuccess: onClose,
    onError: (error) => {
      logger.warn(
        { action: 'unmappedParticipant.bind.failed', err: error },
        'Binding a provider identity to a participant was rejected',
      );
    },
  });

  return (
    <FormModal
      canSave={participantId.length > 0}
      description={`${competitor.providerName} reports ${competitor.externalName} (${competitor.externalId}). Choose the ${competitor.sport} participant they are.`}
      error={bindMutation.error}
      isPending={bindMutation.isPending}
      onCancel={onClose}
      onOpenChange={(next) => !next && onClose()}
      onSave={() => bindMutation.mutate()}
      open
      saveLabel="Map competitor"
      saveTestId="root-admin-unmapped-participant-map-save"
      testId="root-admin-unmapped-participant-map-modal"
      title="Map competitor"
    >
      <div className="space-y-3">
        <FormField label="Search participants">
          <Input
            data-testid="root-admin-unmapped-participant-map-search"
            onChange={(event) => {
              setSearch(event.target.value);
              setParticipantId('');
            }}
            value={search}
          />
        </FormField>
        <FormField
          error={candidatesQuery.isError
            ? extractErrorMessage(candidatesQuery.error, { fallback: 'We could not search participants right now.' })
            : undefined}
          label="Participant"
        >
          <Select
            data-testid="root-admin-unmapped-participant-map-participant"
            disabled={candidates.length === 0}
            onChange={(event) => setParticipantId(event.target.value)}
            value={participantId}
          >
            <option value="">
              {candidatesQuery.isFetching
                ? 'Searching...'
                : candidates.length === 0
                  ? 'No matching participants'
                  : 'Choose a participant'}
            </option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
                {candidate.nationality ? ` (${candidate.nationality})` : ''}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
    </FormModal>
  );
}
