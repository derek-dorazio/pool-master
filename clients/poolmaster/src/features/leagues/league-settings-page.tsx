import { useMemo } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { LeagueRole, LeagueMembershipStatus, PlanCap, PlanFeature } from '@poolmaster/shared/domain';
import { formatUserName } from '@/features/account/user-name';
import {
  Notice,
  formatDateDisplay,
  PageHeader,
  IconAvatar,
  LinkButton,
  LOADING_TEXT,
  SectionBody,
  SectionCard,
  SectionEmpty,
  SettingsRow,
  SettingsRows,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { describePointsTable } from '@/features/championships/cup-settings-view';
import { LeaguePaymentsSection } from '@/features/billing/payment-history-sections';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { ExtendLeagueGift } from '@/features/plans/extend-league-gift';
import { useAuth } from '@/features/auth/auth-context';
import { useSportLeaguesQuery } from '@/features/contest-types/use-sport-leagues-query';
import {
  EVENT_EMAIL_DELIVERY_COPY,
  describeEventEmailSportLeagues,
  describeEventEmailsSection,
  hasEventEmails,
  hasWeeklyDigest,
} from './event-emails-view';
import { LeagueDangerZone } from './league-danger-zone';
import { LeagueIcon } from './league-icon';
import { LEAGUE_PLAN_LABEL, PLAN_CAP_LABEL, formatPlanLimit } from '@/features/plans/plan-labels';
import {
  buildLeagueAdminChampionshipsEditPath,
  buildLeagueAdminEditPath,
  isLeagueSettingsEditOpenedInApp,
  LEAGUE_SETTINGS_EDIT_OPENED_IN_APP_STATE,
  LEAGUE_SETTINGS_EDIT_PARAM,
  buildLeagueAdminEventEmailsEditPath,
  buildLeagueAdminPlanPath,
  buildLeagueAdminTeamsPath,
} from './league-routing';
import { useLeagueContext } from './use-league-context';
import { useLeagueMembersQuery } from './use-league-members-query';
import { EditLeagueDialog } from './edit-league-dialog';

/**
 * League settings, the first page of Commissioner tools: the league's properties with one Edit
 * for all of them, the championship settings with their own Edit, the sport leagues the
 * commissioners hear about (#851) with theirs, the league's plan (#945) with its Change, then the
 * danger zone.
 */
export function LeagueSettingsPage() {
  const displayPreferences = useDisplayPreferences();
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { league } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const { members } = useLeagueMembersQuery(leagueId);
  const sportLeaguesQuery = useSportLeaguesQuery();
  const { isRootAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  // A commissioner is a membership role, and the membership carries the member (#1202).
  const commissionerNames = useMemo(() => {
    const names = (members ?? [])
      .filter((member) => member.status === LeagueMembershipStatus.ACTIVE && member.role === LeagueRole.COMMISSIONER)
      .map((member) => formatUserName(member.user.firstName, member.user.lastName));
    return [...new Set(names)].sort((left, right) => left.localeCompare(right));
  }, [members]);

  const activeMemberCount = members
    ? members.filter((member) => member.status === LeagueMembershipStatus.ACTIVE).length
    : null;

  // The guard above this page has already loaded the league context.
  if (!league) {
    return null;
  }

  const isInactive = !league.isActive;
  // An inactive league is read-only, so its Edit never opens, even from an old link.
  const isEditingGeneral = !isInactive && searchParams.get(LEAGUE_SETTINGS_EDIT_PARAM) === 'general';
  const closeGeneralEdit = () => {
    // Opened by the Edit link: step back over the entry it pushed. Opened by an old link or a
    // reload: there is nothing behind it to return to, so drop the query in place.
    if (isLeagueSettingsEditOpenedInApp(location.state)) {
      void navigate(-1);
      return;
    }
    setSearchParams((params) => {
      params.delete(LEAGUE_SETTINGS_EDIT_PARAM);
      return params;
    }, { replace: true });
  };

  return (
    <div className="space-y-8" data-testid="league-settings-page">
      <PageHeader
        meta={(
          <>
            <span>{`${LEAGUE_PLAN_LABEL[league.planEntitlements.plan]} plan`}</span>
            {activeMemberCount === null ? null : (
              <span>{`${activeMemberCount} ${activeMemberCount === 1 ? 'member' : 'members'}`}</span>
            )}
            <span>{`Created ${formatDateDisplay(league.createdAt, displayPreferences, 'Unknown')}`}</span>
          </>
        )}
        testId="league-settings-header"
        title="League settings"
      />
      {isInactive ? (
        <Notice data-testid="league-inactive-banner" title="This league is inactive." tone="warning">
          Members can still see standings and history. Activate the league in the danger zone to
          make changes again.
        </Notice>
      ) : null}

      <SectionCard
        trailing={(
          <LinkButton
            data-testid="league-settings-edit"
            isDisabled={isInactive}
            size="sm"
            state={LEAGUE_SETTINGS_EDIT_OPENED_IN_APP_STATE}
            to={buildLeagueAdminEditPath(league.leagueCode)}
            variant="secondary"
          >
            Edit
          </LinkButton>
        )}
        help="What members see at the top of League Home."
        testId="league-settings-general"
        title="General"
      >
        <SettingsRows>
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
          <SettingsRow
            action={(
              <LinkButton size="sm" to={buildLeagueAdminTeamsPath(league.leagueCode)} variant="ghost">
                Change
              </LinkButton>
            )}
            label="Commissioners"
            testId="league-settings-commissioners"
            value={!members
              ? <span className="text-muted-foreground">{LOADING_TEXT}</span>
              : commissionerNames.join(', ')}
          />
        </SettingsRows>
      </SectionCard>

      {hasPlanFeature(league, PlanFeature.CUP_SETTINGS) ? (
        <SectionCard
          trailing={(
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
          help="What each finishing place earns toward the championship and every sports league cup."
          testId="league-settings-championships"
          title="Championships"
        >
          <SettingsRows>
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
          </SettingsRows>
        </SectionCard>
      ) : (
        <SectionCard
          footer={{ label: 'Change plan', testId: 'league-settings-championships-plan', to: buildLeagueAdminPlanPath(league.leagueCode) }}
          testId="league-settings-championships"
          title="Championships"
        >
          <SectionEmpty>Your league&apos;s plan doesn&apos;t include championship settings.</SectionEmpty>
        </SectionCard>
      )}

      {hasEventEmails(league) ? (
        <SectionCard
          trailing={(
            <LinkButton
              data-testid="league-settings-event-emails-edit"
              isDisabled={isInactive}
              size="sm"
              to={buildLeagueAdminEventEmailsEditPath(league.leagueCode)}
              variant="secondary"
            >
              Edit
            </LinkButton>
          )}
          help={describeEventEmailsSection(league)}
          testId="league-settings-event-emails"
          title="Event emails"
        >
          <SettingsRows>
            <SettingsRow
              label="Sport leagues"
              testId="league-settings-event-emails-sport-leagues"
              value={sportLeaguesQuery.data
                ? describeEventEmailSportLeagues(sportLeaguesQuery.data, league.mutedSportLeagueIds)
                : <span className="text-muted-foreground">{sportLeaguesQuery.isError ? 'Unavailable' : LOADING_TEXT}</span>}
            />
            {hasWeeklyDigest(league) ? (
              <SettingsRow
                label="Delivery"
                testId="league-settings-event-emails-delivery"
                value={EVENT_EMAIL_DELIVERY_COPY[league.eventEmailDelivery].label}
              />
            ) : null}
          </SettingsRows>
        </SectionCard>
      ) : (
        <SectionCard
          footer={{ label: 'Change plan', testId: 'league-settings-event-emails-plan', to: buildLeagueAdminPlanPath(league.leagueCode) }}
          testId="league-settings-event-emails"
          title="Event emails"
        >
          <SectionEmpty>Your league&apos;s plan doesn&apos;t include event emails.</SectionEmpty>
        </SectionCard>
      )}

      <SectionCard
        trailing={(
          <LinkButton
            data-testid="league-settings-plan-edit"
            isDisabled={isInactive}
            size="sm"
            to={buildLeagueAdminPlanPath(league.leagueCode)}
            variant="secondary"
          >
            Change
          </LinkButton>
        )}
        help="What the league can do. Every plan is free for now, and members never see which plan it is."
        testId="league-settings-plan"
        title="Plan"
      >
        <SettingsRows>
          <SettingsRow
            label="Plan"
            testId="league-settings-plan-name"
            value={<span className="font-semibold">{LEAGUE_PLAN_LABEL[league.planEntitlements.plan]}</span>}
          />
          <SettingsRow
            label="Premium preview period ends"
            testId="league-settings-plan-renews"
            value={formatDateDisplay(league.planRenewsAt, displayPreferences)}
          />
          {Object.values(PlanCap).map((cap) => (
            <SettingsRow
              key={cap}
              label={PLAN_CAP_LABEL[cap]}
              testId={`league-settings-plan-cap-${cap}`}
              value={formatPlanLimit(league.planEntitlements.caps[cap], displayPreferences.locale)}
            />
          ))}
          {isRootAdmin ? <SectionBody><ExtendLeagueGift league={league} /></SectionBody> : null}
        </SettingsRows>
      </SectionCard>

      <LeaguePaymentsSection leagueCode={league.leagueCode} leagueId={league.id} />

      <LeagueDangerZone league={league} />

      <EditLeagueDialog league={league} onClose={closeGeneralEdit} open={isEditingGeneral} />
    </div>
  );
}
