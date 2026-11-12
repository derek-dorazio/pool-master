import { useQuery } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { useParams } from 'react-router';
import { listParticipantProviderMappings } from '@/lib/api';
import {
  AsyncPage,
  LinkButton,
  PageHeader,
  QueryState,
  SectionCard,
  SectionRow,
  SectionRows,
  SettingsRow,
  SettingsRows,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { ParticipantDto, ParticipantProviderMappingDto } from '@/lib/api';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { participantStatusLabel, participantStatusTone } from './sport-admin-utils';
import { buildSportParticipantPath } from './manage-navigation';
import { useParticipantQuery } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';
import { upperFirst } from '@/lib/upper-first';

function ParticipantMappingsSection({ participantId }: { participantId: string }) {
  const { participant } = useManagedSport().definition.vocabulary;
  const mappingsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.participantMappings(participantId),
    queryFn: async (): Promise<ParticipantProviderMappingDto[]> => {
      const response = await listParticipantProviderMappings({ path: { id: participantId } });
      if (!response.data?.providerMappings) {
        throwApiError(response.error, 'Provider mapping response is missing data.');
      }
      return response.data.providerMappings;
    },
    retry: false,
  });
  const providerMappings = mappingsQuery.data ?? [];

  return (
    <SectionCard
      help={`How this ${participant.one} is matched in each provider’s feed. Read-only.`}
      testId="root-admin-participant-home-mappings-section"
      // poolmaster-allow-list-lookup: counts the mappings listed right below it
      title={`Provider mappings (${providerMappings.length})`}
    >
      <QueryState
        empty="No provider mappings recorded."
        error={extractErrorMessage(mappingsQuery.error, {
          fallback: `We could not load this ${participant.one}’s provider mappings.`,
        })}
        isEmpty={(mappings) => mappings.length === 0}
        loading="Loading provider mappings..."
        query={mappingsQuery}
        testId="root-admin-participant-home-mappings-state"
      >
        {(mappings) => (
          <SectionRows testId="root-admin-participant-home-mappings">
            {mappings.map((mapping) => (
              <SectionRow
                aside={<StatusBadge tone="neutral">{mapping.confidence}</StatusBadge>}
                facts={mapping.externalId}
                key={mapping.id}
                name={mapping.providerId}
              />
            ))}
          </SectionRows>
        )}
      </QueryState>
    </SectionCard>
  );
}

function ParticipantHome({ player }: { player: ParticipantDto }) {
  const { sport } = useManagedSport();
  return (
    <div className="space-y-8">
      <PageHeader
        icon={<UserRound aria-hidden size={22} />}
        meta={player.nationality ? <span>{player.nationality}</span> : undefined}
        status={(
          <StatusBadge tone={participantStatusTone(player.status)}>
            {participantStatusLabel(player.status)}
          </StatusBadge>
        )}
        title={player.name}
        testId="root-admin-participant-identity"
      />

      <SectionCard
        trailing={(
          <LinkButton
            data-testid="root-admin-participant-home-edit"
            size="sm"
            to={`${buildSportParticipantPath(sport, player.id)}/edit`}
            variant="secondary"
          >
            Edit
          </LinkButton>
        )}
        testId="root-admin-participant-details"
        title="Details"
      >
        <SettingsRows>
          <SettingsRow label="First name" value={player.firstName || 'Not set'} />
          <SettingsRow label="Last name" value={player.lastName || 'Not set'} />
          <SettingsRow label="Short name" value={player.shortName || 'Not set'} />
          <SettingsRow label="Nationality" value={player.nationality || 'Not set'} />
          <SettingsRow label="Role" value={player.role || 'Not set'} />
          <SettingsRow label="Team affiliation" value={player.teamAffiliation || 'Not set'} />
          <SettingsRow label="External ID" value={player.externalId || 'Not set'} />
          <SettingsRow
            label="Status"
            testId="root-admin-participant-status-row"
            value={participantStatusLabel(player.status)}
          />
        </SettingsRows>
      </SectionCard>

      <ParticipantMappingsSection participantId={player.id} />
    </div>
  );
}

/**
 * A participant's page in Manage (a golfer, a horse): the identity heading, the details with one
 * Edit (status included: removing one is a status change, never a delete) and the read-only
 * provider mappings.
 */
export function RootAdminParticipantHomePage() {
  const { participantId = '' } = useParams<{ participantId: string }>();
  const { participant } = useManagedSport().definition.vocabulary;
  const playerQuery = useParticipantQuery(participantId);
  const player = playerQuery.data;

  useManageBreadcrumbOverride(participantId || undefined, player?.name);

  const pageState = playerQuery.isLoading
    ? 'loading'
    : playerQuery.isError
      ? 'error'
      : participantId === '' || !player
        ? 'empty'
        : 'ready';

  return (
    <AsyncPage
      emptyBody={`This ${participant.one} does not exist or has been removed.`}
      emptyTitle={`${upperFirst(participant.one)} not found`}
      errorBody={extractErrorMessage(playerQuery.error, {
        fallback: `We could not load this ${participant.one} right now.`,
      })}
      loadingBody={`Loading ${participant.one}...`}
      state={pageState}
      testId="root-admin-participant-home-page"
    >
      {player ? <ParticipantHome player={player} /> : null}
    </AsyncPage>
  );
}
