import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  bindParticipantProviderMapping,
  listParticipants,
  listSports,
  type UnmappedProviderParticipantDto,
} from '@/lib/api';
import { AsyncPage, FormField, FormPage, Input, Select } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { UNMAPPED_COMPETITORS_PATH } from './manage-navigation';
import { useUnmappedCompetitorsQuery } from './use-unmapped-competitors';

function MapCompetitorForm({ competitor }: { competitor: UnmappedProviderParticipantDto }) {
  const logger = getLogger().child({ feature: 'root-admin-map-competitor-page' });
  const navigate = useNavigate();
  // Seeded from the provider's spelling, the likeliest match.
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
    onSuccess: () => navigate(UNMAPPED_COMPETITORS_PATH),
    onError: (error) => {
      logger.warn(
        { action: 'unmappedParticipant.bind.failed', err: error },
        'Binding a provider identity to a participant was rejected',
      );
    },
  });

  return (
    <FormPage
      cancelTo={UNMAPPED_COMPETITORS_PATH}
      description={`${competitor.providerName} reports ${competitor.externalName} (${competitor.externalId}). Choose the ${competitor.sport} participant they are.`}
      errorMessage={bindMutation.isError
        ? extractErrorMessage(bindMutation.error, { fallback: 'We could not map this competitor.' })
        : undefined}
      isPending={bindMutation.isPending}
      isSubmitDisabled={participantId.length === 0}
      onSubmit={(event) => {
        event.preventDefault();
        if (participantId.length > 0) {
          bindMutation.mutate();
        }
      }}
      pendingLabel="Mapping..."
      submitLabel="Map competitor"
      submitTestId="root-admin-unmapped-participant-map-save"
      testId="root-admin-unmapped-participant-map-page"
      title={competitor.externalName}
    >
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
    </FormPage>
  );
}

/**
 * Map one competitor a provider reports to the participant they are, so the provider's synced
 * scores have somewhere to land. The competitor is named by its provider and provider id in the
 * query string; once mapped it leaves the unmapped list, so the page then says so.
 */
export function RootAdminMapCompetitorPage() {
  const [searchParams] = useSearchParams();
  const providerId = searchParams.get('provider') ?? '';
  const externalId = searchParams.get('competitor') ?? '';
  const unmappedQuery = useUnmappedCompetitorsQuery();
  const competitor = unmappedQuery.data?.find(
    (candidate) => candidate.providerId === providerId && candidate.externalId === externalId,
  );

  return (
    <AsyncPage
      emptyBody="This competitor is already mapped, or the provider no longer reports them."
      emptyTitle="Nothing to map"
      errorBody={extractErrorMessage(unmappedQuery.error, {
        fallback: 'We could not load unmapped competitors right now.',
      })}
      loadingBody="Loading competitor..."
      state={unmappedQuery.isLoading
        ? 'loading'
        : unmappedQuery.isError
          ? 'error'
          : competitor
            ? 'ready'
            : 'empty'}
    >
      {competitor ? <MapCompetitorForm competitor={competitor} /> : null}
    </AsyncPage>
  );
}
