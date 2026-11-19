import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  bindParticipantProviderMapping,
  type UnmappedProviderParticipantDto,
} from '@/lib/api';
import { ErrorState, FormField, FormPage, Input, LOADING_TEXT, QueryState, Select } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { UNMAPPED_COMPETITORS_PATH } from './manage-navigation';
import { useLeagueRosterQuery, useSportLeaguesQuery } from './use-sport-catalog';
import { useUnmappedCompetitorQuery } from './use-unmapped-competitors';

/**
 * The competitor's sport league, then its participant: a participant belongs to one sport league
 * (#1853), so the identity is mapped within the league chosen. The league's roster is read whole
 * and narrowed by the name box in the browser.
 */
function MapCompetitorForm({ competitor }: { competitor: UnmappedProviderParticipantDto }) {
  const logger = getLogger().child({ feature: 'root-admin-map-competitor-page' });
  const navigate = useNavigate();
  const [sportLeagueId, setSportLeagueId] = useState('');
  // Seeded from the provider's spelling, the likeliest match.
  const [search, setSearch] = useState(competitor.externalName);
  const [participantId, setParticipantId] = useState('');
  const needle = search.trim().toLowerCase();

  const leaguesQuery = useSportLeaguesQuery(competitor.sport);
  const rosterQuery = useLeagueRosterQuery(sportLeagueId);
  const candidates = useMemo(
    () => (rosterQuery.data ?? []).filter((candidate) => needle === '' || candidate.name.toLowerCase().includes(needle)),
    [needle, rosterQuery.data],
  );

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
    invalidates: [QueryKeys.rootAdmin.unmappedProviderParticipants, QueryKeys.rootAdmin.manageSport.participants],
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
      help={`Choose the sport league and the participant in it this ${competitor.providerName} competitor is.`}
      meta={`${competitor.providerName} reports ${competitor.externalName} (${competitor.externalId}) · ${competitor.sport}`}
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
      {leaguesQuery.isError || rosterQuery.isError ? (
        <ErrorState
          body={extractErrorMessage(leaguesQuery.error ?? rosterQuery.error, { fallback: 'We could not load the participants to choose from right now.' })}
          onRetry={() => void (leaguesQuery.isError ? leaguesQuery.refetch() : rosterQuery.refetch())}
          testId="root-admin-unmapped-participant-map-error"
        />
      ) : null}
      <FormField label="Sport league">
        <Select
          data-testid="root-admin-unmapped-participant-map-league"
          onChange={(event) => {
            setSportLeagueId(event.target.value);
            setParticipantId('');
          }}
          value={sportLeagueId}
        >
          <option value="">{leaguesQuery.data ? 'Choose a sport league' : LOADING_TEXT}</option>
          {(leaguesQuery.data ?? []).map((league) => (
            <option key={league.id} value={league.id}>{league.name}</option>
          ))}
        </Select>
      </FormField>
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
      <FormField label="Participant">
        <Select
          data-testid="root-admin-unmapped-participant-map-participant"
          disabled={candidates.length === 0}
          onChange={(event) => setParticipantId(event.target.value)}
          value={participantId}
        >
          <option value="">
            {sportLeagueId === ''
              ? 'Choose a sport league first'
              : rosterQuery.isFetching
              ? LOADING_TEXT
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
  // Claimed at once, so Manage never shows its own title while the page loads.
  const [searchParams] = useSearchParams();
  const providerId = searchParams.get('provider') ?? '';
  const externalId = searchParams.get('competitor') ?? '';
  const unmappedQuery = useUnmappedCompetitorQuery(providerId, externalId);

  return (
    <QueryState
      empty="Nothing to map: this competitor is already mapped, or the provider no longer reports them."
      error={extractErrorMessage(unmappedQuery.error, {
        fallback: 'We could not load unmapped competitors right now.',
      })}
      isEmpty={(competitor) => competitor === null}
      loading="Loading competitor..."
      query={unmappedQuery}
      size="tile"
      testId="root-admin-map-competitor"
    >
      {(competitor) => (competitor ? <MapCompetitorForm competitor={competitor} /> : null)}
    </QueryState>
  );
}
