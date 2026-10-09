import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { LeagueRole, LeagueMembershipStatus, SquadMembershipStatus } from '@poolmaster/shared/domain';
import { formatUserName } from '@/features/account/user-name';
import {
  Alert,
  formatDateDisplay,
  IconAvatar,
  LinkButton,
  SettingsRow,
  SettingsSection,
} from '@/features/shared/ui';
import { useLeagueSquadsQuery } from '@/features/teams/use-league-squads-query';
import { LeagueDangerZone } from './league-danger-zone';
import { LeagueIcon } from './league-icon';
import { buildLeagueAdminEditPath, buildLeagueTeamsPath } from './league-routing';
import { useLeagueContext } from './use-league-context';
import { useLeagueMembersQuery } from './use-league-members-query';

/**
 * League settings, the first page of Commissioner tools: the league's properties with one Edit
 * for all of them, then the danger zone.
 */
export function LeagueSettingsPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { league } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const { members } = useLeagueMembersQuery(leagueId);
  const squadsQuery = useLeagueSquadsQuery(leagueId);

  // A commissioner is a membership role; their name comes from the team they own.
  const commissionerNames = useMemo(() => {
    const commissionerUserIds = new Set(
      (members ?? [])
        .filter((member) => member.status === LeagueMembershipStatus.ACTIVE && member.role === LeagueRole.COMMISSIONER)
        .map((member) => member.userId),
    );
    const names = (squadsQuery.data ?? []).flatMap((squad) =>
      (squad.members ?? [])
        .filter((member) => member.status === SquadMembershipStatus.ACTIVE && commissionerUserIds.has(member.user.id))
        .map((member) => formatUserName(member.user.firstName, member.user.lastName)),
    );
    return [...new Set(names)].sort((left, right) => left.localeCompare(right));
  }, [members, squadsQuery.data]);

  // The guard above this page has already loaded the league context.
  if (!league) {
    return null;
  }

  const isInactive = !league.isActive;

  return (
    <div className="space-y-8" data-testid="league-settings-page">
      {isInactive ? (
        <Alert data-testid="league-inactive-banner" title="This league is inactive." tone="warning">
          Members can still see standings and history. Activate the league in the danger zone to
          make changes again.
        </Alert>
      ) : null}

      <SettingsSection
        action={(
          <LinkButton
            data-testid="league-settings-edit"
            isDisabled={isInactive}
            size="sm"
            to={buildLeagueAdminEditPath(league.leagueCode)}
            variant="secondary"
          >
            Edit
          </LinkButton>
        )}
        description="What members see at the top of League Home."
        testId="league-settings-general"
        title="General"
      >
        <SettingsRow
          label="Name and icon"
          testId="league-settings-name"
          value={(
            <span className="flex items-center gap-3">
              <IconAvatar size="sm">
                <LeagueIcon iconKey={league.iconKey} size="md" />
              </IconAvatar>
              <span className="font-semibold">{league.name}</span>
            </span>
          )}
        />
        <SettingsRow
          label="Description"
          testId="league-settings-description"
          value={league.description?.trim() || <span className="text-muted-foreground">No description</span>}
        />
        <SettingsRow
          action={<span className="text-xs text-muted-foreground">Permanent</span>}
          label="League code"
          value={<span className="font-mono">{league.leagueCode}</span>}
        />
        <SettingsRow label="Created" value={formatDateDisplay(league.createdAt, 'Unknown')} />
        <SettingsRow
          action={(
            <LinkButton size="sm" to={buildLeagueTeamsPath(league.leagueCode)} variant="ghost">
              Change
            </LinkButton>
          )}
          label="Commissioners"
          testId="league-settings-commissioners"
          value={squadsQuery.isLoading || !members
            ? <span className="text-muted-foreground">Loading...</span>
            : commissionerNames.join(', ')}
        />
      </SettingsSection>

      <LeagueDangerZone league={league} />
    </div>
  );
}
