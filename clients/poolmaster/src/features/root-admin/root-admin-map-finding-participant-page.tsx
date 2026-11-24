import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ProviderSyncFindingAction } from '@poolmaster/shared/domain';
import type { ProviderSyncFindingDto } from '@/lib/api';
import { ErrorState, FormField, FormPage, Input, LOADING_TEXT, QueryState, Select } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { SYNC_FINDINGS_PATH } from './manage-navigation';
import { syncFindingSubject } from './sync-finding-labels';
import { useLeagueRosterQuery } from './use-sport-catalog';
import { useMapSyncFindingParticipant, useSyncFindingQuery } from './use-sync-findings';

/**
 * The finding's sport league's roster, read whole and narrowed by the name box in the browser: a
 * participant belongs to one sport league (#1853), so the feed's id is mapped within the finding's.
 */
function MapParticipantForm({ finding }: { finding: ProviderSyncFindingDto }) {
  const logger = getLogger().child({ feature: 'root-admin-map-finding-participant-page' });
  const navigate = useNavigate();
  // Seeded from the feed's spelling when it sent one, the likeliest match.
  const [search, setSearch] = useState(finding.providerValueName ?? '');
  const [participantId, setParticipantId] = useState('');
  const needle = search.trim().toLowerCase();

  const rosterQuery = useLeagueRosterQuery(finding.sportLeague.id);
  const candidates = useMemo(
    () => (rosterQuery.data ?? []).filter((candidate) => needle === '' || candidate.name.toLowerCase().includes(needle)),
    [needle, rosterQuery.data],
  );

  const mapMutation = useMapSyncFindingParticipant(finding.id, {
    onSuccess: () => void navigate(SYNC_FINDINGS_PATH),
  });
  const providerName = finding.provider?.name ?? '';

  return (
    <FormPage
      cancelTo={SYNC_FINDINGS_PATH}
      help={`Choose the participant of ${finding.sportLeague.name} this ${providerName} id is. Their synced results land from the next sync.`}
      meta={`${providerName} sent ${syncFindingSubject(finding) ?? ''} · ${finding.sportLeague.name}`}
      errorMessage={mapMutation.isError
        ? extractErrorMessage(mapMutation.error, { fallback: 'We could not map this participant.' })
        : undefined}
      isPending={mapMutation.isPending}
      isSubmitDisabled={participantId.length === 0}
      onSubmit={(event) => {
        event.preventDefault();
        if (participantId.length > 0) {
          mapMutation.mutate(participantId, {
            onError: (error) => logger.warn({ action: 'syncFinding.mapParticipant.failed', err: error }, 'Mapping a finding\'s feed participant was refused'),
          });
        }
      }}
      pendingLabel="Mapping..."
      submitLabel="Map participant"
      submitTestId="root-admin-map-finding-participant-save"
      testId="root-admin-map-finding-participant-page"
      title={syncFindingSubject(finding) ?? finding.sportLeague.name}
    >
      {rosterQuery.isError ? (
        <ErrorState
          body={extractErrorMessage(rosterQuery.error, { fallback: 'We could not load the participants to choose from right now.' })}
          onRetry={() => void rosterQuery.refetch()}
          testId="root-admin-map-finding-participant-error"
        />
      ) : null}
      <FormField label="Search participants">
        <Input
          data-testid="root-admin-map-finding-participant-search"
          onChange={(event) => {
            setSearch(event.target.value);
            setParticipantId('');
          }}
          value={search}
        />
      </FormField>
      <FormField label="Participant">
        <Select
          data-testid="root-admin-map-finding-participant-participant"
          disabled={candidates.length === 0}
          onChange={(event) => setParticipantId(event.target.value)}
          value={participantId}
        >
          <option value="">
            {rosterQuery.isFetching
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
 * /manage/providers/findings/:findingId/map-participant (#1999): an unmapped participant finding's
 * fix, opened from its dialog. Mapping resolves the finding; a finding that no longer offers it
 * (mapped, waived or resolved) says so instead of the form.
 */
export function RootAdminMapFindingParticipantPage() {
  const { findingId = '' } = useParams<{ findingId: string }>();
  const findingQuery = useSyncFindingQuery(findingId);
  useManageBreadcrumbOverride(findingId || undefined, findingQuery.data ? syncFindingSubject(findingQuery.data) : undefined);

  return (
    <QueryState
      empty="Nothing to map: this finding is no longer open."
      error={extractErrorMessage(findingQuery.error, { fallback: 'We could not load this finding right now.' })}
      isEmpty={(finding) => !finding.actions.includes(ProviderSyncFindingAction.MAP_PARTICIPANT)}
      loading="Loading finding..."
      query={findingQuery}
      size="tile"
      testId="root-admin-map-finding-participant"
    >
      {(finding) => <MapParticipantForm finding={finding} />}
    </QueryState>
  );
}
