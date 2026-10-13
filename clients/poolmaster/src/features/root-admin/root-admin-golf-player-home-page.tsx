import { useQuery } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { listParticipantProviderMappings } from '@/lib/api';
import {
  AsyncPage,
  IdentityHeading,
  LinkButton,
  SettingsRow,
  SettingsSection,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { ParticipantDto, ParticipantProviderMappingDto } from '@/lib/api';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';
import { golfPlayerStatusLabel, golfPlayerStatusTone } from './golf-admin-utils';
import { buildSportParticipantPath, capitalize } from './manage-navigation';
import { useGolfPlayerQuery } from './use-golf-catalog';
import { useManagedSport } from './use-managed-sport';

function GolfPlayerMappingsSection({ participantId }: { participantId: string }) {
  const { participant } = useManagedSport().definition.vocabulary;
  const mappingsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.playerMappings(participantId),
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
    <SettingsSection
      description={`How this ${participant.one} is matched in each provider’s feed. Read-only.`}
      testId="root-admin-golf-player-home-mappings-section"
      title={`Provider mappings (${providerMappings.length})`}
    >
      {mappingsQuery.isError ? (
        <p className="px-5 py-4 text-sm text-destructive" data-testid="root-admin-golf-player-home-mappings-error">
          {extractErrorMessage(mappingsQuery.error, {
            fallback: `We could not load this ${participant.one}’s provider mappings.`,
          })}
        </p>
      ) : mappingsQuery.isLoading ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">Loading provider mappings…</p>
      ) : providerMappings.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">No provider mappings recorded.</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="root-admin-golf-player-home-mappings">
          {providerMappings.map((mapping) => (
            <li className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm" key={mapping.id}>
              <span className="font-medium text-foreground">{mapping.providerId}</span>
              <span className="text-muted-foreground">{mapping.externalId}</span>
              <StatusBadge tone="neutral">{mapping.confidence}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

function GolfPlayerHome({ player }: { player: ParticipantDto }) {
  const { sport } = useManagedSport();
  return (
    <div className="space-y-8">
      <IdentityHeading
        icon={<UserRound aria-hidden size={22} />}
        meta={(
          <>
            <StatusBadge tone={golfPlayerStatusTone(player.status)}>
              {golfPlayerStatusLabel(player.status)}
            </StatusBadge>
            {player.nationality ? <span>{player.nationality}</span> : null}
          </>
        )}
        name={player.name}
        testId="root-admin-golf-player-identity"
      />

      <SettingsSection
        action={(
          <LinkButton
            data-testid="root-admin-golf-player-home-edit"
            size="sm"
            to={`${buildSportParticipantPath(sport, player.id)}/edit`}
            variant="secondary"
          >
            Edit
          </LinkButton>
        )}
        testId="root-admin-golf-player-details"
        title="Details"
      >
        <SettingsRow label="First name" value={player.firstName || 'Not set'} />
        <SettingsRow label="Last name" value={player.lastName || 'Not set'} />
        <SettingsRow label="Short name" value={player.shortName || 'Not set'} />
        <SettingsRow label="Nationality" value={player.nationality || 'Not set'} />
        <SettingsRow label="Role" value={player.role || 'Not set'} />
        <SettingsRow label="Team affiliation" value={player.teamAffiliation || 'Not set'} />
        <SettingsRow label="External ID" value={player.externalId || 'Not set'} />
        <SettingsRow
          label="Status"
          testId="root-admin-golf-player-status-row"
          value={golfPlayerStatusLabel(player.status)}
        />
      </SettingsSection>

      <GolfPlayerMappingsSection participantId={player.id} />
    </div>
  );
}

/**
 * A participant's page in Manage (a golfer, a horse): the identity heading, the details with one
 * Edit (status included: removing one is a status change, never a delete) and the read-only
 * provider mappings.
 */
export function RootAdminGolfPlayerHomePage() {
  const { participantId = '' } = useParams<{ participantId: string }>();
  const { participant } = useManagedSport().definition.vocabulary;
  const playerQuery = useGolfPlayerQuery(participantId);
  const player = playerQuery.data;

  useManagePageOwnsHeading();
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
      emptyTitle={`${capitalize(participant.one)} not found`}
      errorBody={extractErrorMessage(playerQuery.error, {
        fallback: `We could not load this ${participant.one} right now.`,
      })}
      loadingBody={`Loading ${participant.one}...`}
      state={pageState}
      testId="root-admin-golf-player-home-page"
    >
      {player ? <GolfPlayerHome player={player} /> : null}
    </AsyncPage>
  );
}
