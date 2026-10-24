import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { LeagueRole, LeagueMembershipStatus, PlanCap, PlanFeature, SquadMembershipStatus } from '@poolmaster/shared/domain';
import { formatUserName } from '@/features/account/user-name';
import {
  Alert,
  formatDateDisplay,
  IconAvatar,
  LinkButton,
  SettingsRow,
  SettingsSection,
  SettingsSectionHeader,
} from '@/features/shared/ui';
import { describePointsTable } from '@/features/championships/cup-settings-view';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { useLeagueSquadsQuery } from '@/features/teams/use-league-squads-query';
import { LeagueDangerZone } from './league-danger-zone';
import { LeagueIcon } from './league-icon';
import { LEAGUE_PLAN_LABEL, PLAN_CAP_LABEL, formatPlanLimit } from '@/features/plans/plan-labels';
import {
  buildLeagueAdminChampionshipsEditPath,
  buildLeagueAdminEditPath,
  buildLeagueAdminPlanEditPath,
  buildLeagueAdminTeamsPath,
} from './league-routing';
import { useLeagueContext } from './use-league-context';
import { useLeagueMembersQuery } from './use-league-members-query';

/**
 * League settings, the first page of Commissioner tools: the league's properties with one Edit
 * for all of them, the championship settings with their own Edit, the league's plan (#945) with
 * its Change, then the danger zone.
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
            <LinkButton size="sm" to={buildLeagueAdminTeamsPath(league.leagueCode)} variant="ghost">
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

      {hasPlanFeature(league, PlanFeature.CUP_SETTINGS) ? (
        <SettingsSection
          action={(
            <LinkButton
              data-testid="league-settings-championships-edit"
              isDisabled={isInactive}
              size="sm"
              to={buildLeagueAdminChampionshipsEditPath(league.leagueCode)}
              variant="secondary"
            >
              Edit
            </LinkButton>
          )}
          description="What each finishing place earns toward the championship and every sports league cup."
          testId="league-settings-championships"
          title="Championships"
        >
          <SettingsRow
            label="Championship name"
            testId="league-settings-cup-name"
            value={<span className="font-semibold">{league.cupName}</span>}
          />
          <SettingsRow
            label="Points table"
            testId="league-settings-points-table"
            value={describePointsTable({ scale: league.cupPointsScale, customPoints: league.cupCustomPoints })}
          />
          {hasPlanFeature(league, PlanFeature.RECORD_BOOK) ? (
            <SettingsRow
              label="Hall of Lame"
              testId="league-settings-hall-of-lame"
              value={league.hallOfLameVisible ? 'Shown' : 'Hidden'}
            />
          ) : null}
        </SettingsSection>
      ) : (
        <section className="space-y-3" data-testid="league-settings-championships">
          <SettingsSectionHeader
            action={(
              <LinkButton data-testid="league-settings-championships-plan" size="sm" to={buildLeagueAdminPlanEditPath(league.leagueCode)} variant="secondary">
                Change plan
              </LinkButton>
            )}
            description="Your league's plan doesn't include championship settings."
            title="Championships"
          />
        </section>
      )}

      <SettingsSection
        action={(
          <LinkButton
            data-testid="league-settings-plan-edit"
            isDisabled={isInactive}
            size="sm"
            to={buildLeagueAdminPlanEditPath(league.leagueCode)}
            variant="secondary"
          >
            Change
          </LinkButton>
        )}
        description="What the league can do. Every plan is free for now, and members never see which plan it is."
        testId="league-settings-plan"
        title="Plan"
      >
        <SettingsRow
          label="Plan"
          testId="league-settings-plan-name"
          value={<span className="font-semibold">{LEAGUE_PLAN_LABEL[league.planEntitlements.plan]}</span>}
        />
        {Object.values(PlanCap).map((cap) => (
          <SettingsRow
            key={cap}
            label={PLAN_CAP_LABEL[cap]}
            testId={`league-settings-plan-cap-${cap}`}
            value={formatPlanLimit(league.planEntitlements.caps[cap])}
          />
        ))}
      </SettingsSection>

      <LeagueDangerZone league={league} />
    </div>
  );
}
