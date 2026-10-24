import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthHomePage } from '@/features/auth/auth-home-page';
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page';
import { ResetPasswordPage } from '@/features/auth/reset-password-page';
import { EmailUnsubscribePage } from '@/features/account/email-unsubscribe-page';
import { MyAccountPage } from '@/features/account/my-account-page';
import { UserPage } from '@/features/account/user-page';
import { AppShell } from '@/features/app-shell/app-shell';
import { NotFoundPage } from '@/features/app-shell/not-found-page';
import { AllYearsPage } from '@/features/championships/all-years-page';
import { ChampionshipPage } from '@/features/championships/championship-page';
import { ChampionshipsLayout, ChampionshipsRedirect } from '@/features/championships/championships-layout';
import { CupSquadPointsPage } from '@/features/championships/cup-squad-points-page';
import { PointsRacePage } from '@/features/championships/points-race-page';
import { TrophyCasePage } from '@/features/championships/trophy-case-page';
import { HowToPlayPage } from '@/features/contest-types/how-to-play-page';
import { LeagueContestTypesPage } from '@/features/contest-types/league-contest-types-page';
import { CreateContestPage } from '@/features/contests/create-contest-page';
import { ContestDetailPage } from '@/features/contests/contest-detail-page';
import { ContestEntryPage } from '@/features/contests/contest-entry-page';
import { ContestLeaderboardPage } from '@/features/contests/contest-leaderboard-page';
import { LeagueContestHistoryPage } from '@/features/contests/league-contest-history-page';
import { LeagueContestsPage } from '@/features/contests/league-contests-page';
import { ContestEventsPage } from '@/features/contests/contest-events-page';
import { EditContestPage } from '@/features/contests/edit-contest-page';
import { ManageContestPage } from '@/features/contests/manage-contest-page';
import { ManageContestsPage } from '@/features/contests/manage-contests-page';
import { JoinLeaguePage } from '@/features/leagues/join-league-page';
import { CommissionerToolsLayout } from '@/features/leagues/commissioner-tools-layout';
import { EditLeaguePage } from '@/features/leagues/edit-league-page';
import { EditChampionshipSettingsPage } from '@/features/championships/edit-championship-settings-page';
import { EditEventEmailsPage } from '@/features/leagues/edit-event-emails-page';
import { EditLeaguePlanPage } from '@/features/plans/edit-league-plan-page';
import { EditContestCupWeightPage } from '@/features/contests/edit-contest-cup-weight-page';
import { LeagueHomePage } from '@/features/leagues/league-home-page';
import { LeagueSettingsPage } from '@/features/leagues/league-settings-page';
import { WelcomePage } from '@/features/leagues/leagues-page';
import { RootAdminContentConfigurationDetailPage } from '@/features/root-admin/root-admin-content-configuration-detail-page';
import { RootAdminContentConfigurationListPage } from '@/features/root-admin/root-admin-content-configuration-list-page';
import { RootAdminEventsPage } from '@/features/root-admin/root-admin-events-page';
import { RootAdminSportLeagueCreatePage } from '@/features/root-admin/root-admin-sport-league-create-page';
import { RootAdminSportLeagueEditPage } from '@/features/root-admin/root-admin-sport-league-edit-page';
import { RootAdminSportLeagueHomePage } from '@/features/root-admin/root-admin-sport-league-home-page';
import { RootAdminParticipantCreatePage } from '@/features/root-admin/root-admin-participant-create-page';
import { RootAdminParticipantEditPage } from '@/features/root-admin/root-admin-participant-edit-page';
import { RootAdminParticipantHomePage } from '@/features/root-admin/root-admin-participant-home-page';
import { RootAdminParticipantListPage } from '@/features/root-admin/root-admin-participant-list-page';
import { RootAdminSportLeagueListPage } from '@/features/root-admin/root-admin-sport-league-list-page';
import { RootAdminSportEventCreatePage } from '@/features/root-admin/root-admin-sport-event-create-page';
import { RootAdminSportEventEditPage } from '@/features/root-admin/root-admin-sport-event-edit-page';
import { RootAdminSportEventSchedulePage } from '@/features/root-admin/root-admin-sport-event-schedule-page';
import { RootAdminSportEventFieldPage } from '@/features/root-admin/root-admin-sport-event-field-page';
import { RootAdminSportEventHomePage } from '@/features/root-admin/root-admin-sport-event-home-page';
import { RootAdminSportEventTiersPage } from '@/features/root-admin/root-admin-sport-event-tiers-page';
import { RootAdminSportEventListPage } from '@/features/root-admin/root-admin-sport-event-list-page';
import { RootAdminSportEventResultsPage } from '@/features/root-admin/root-admin-sport-event-results-page';
import { ManageSportEventRoute } from '@/features/root-admin/manage-sport-event-route';
import { ManageSportRoute } from '@/features/root-admin/manage-sport-route';
import { ManageSportLandingRedirect } from '@/features/root-admin/manage-sport-landing-redirect';
import { RootAdminIngestionSchedulePage } from '@/features/root-admin/root-admin-ingestion-schedule-page';
import { RootAdminMapCompetitorPage } from '@/features/root-admin/root-admin-map-competitor-page';
import { SPORTS_LANDING_PATH } from '@/features/root-admin/manage-navigation';
import { ManageLandingRedirect, RootAdminManageLayout } from '@/features/root-admin/root-admin-manage-layout';
import { RootAdminManageLeaguesPage } from '@/features/root-admin/root-admin-manage-leagues-page';
import { RootAdminManageUsersPage } from '@/features/root-admin/root-admin-manage-users-page';
import { RootAdminUserPage } from '@/features/root-admin/root-admin-user-page';
import { RootAdminRunEventSyncPage } from '@/features/root-admin/root-admin-run-event-sync-page';
import { RootAdminSportOverridesPage } from '@/features/root-admin/root-admin-sport-overrides-page';
import { RootAdminSettingsPage } from '@/features/root-admin/root-admin-settings-page';
import { RootAdminPlansPage } from '@/features/root-admin/root-admin-plans-page';
import { RootAdminSyncDashboardPage } from '@/features/root-admin/root-admin-sync-dashboard-page';
import { RootAdminUnmappedParticipantsPage } from '@/features/root-admin/root-admin-unmapped-participants-page';
import { JoinTeamOwnerPage } from '@/features/teams/join-team-owner-page';
import { MyTeamEditPage } from '@/features/teams/my-team-edit-page';
import { MyTeamPage } from '@/features/teams/my-team-page';
import { TeamPage } from '@/features/teams/team-page';
import { TeamsPage } from '@/features/teams/teams-page';
import { AdminEditTeamPage } from '@/features/teams/admin-edit-team-page';
import { InvitesPage } from '@/features/teams/invites-page';
import { ManageTeamPage } from '@/features/teams/manage-team-page';
import { ManageTeamsPage } from '@/features/teams/manage-teams-page';
import {
  LegacyContestCreateRedirect,
  LegacyContestManageRedirect,
  LegacyGolfManageRedirect,
  LegacyJoinInviteRedirect,
  LegacyLeagueEntriesRedirect,
  LegacyManageContestsRedirect,
} from './legacy-redirects';
import { CommissionerRouteGuard, MemberRouteGuard, RootAdminRouteGuard } from './route-guards';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <AuthHomePage />,
      },
      {
        path: 'how-to-play',
        element: <HowToPlayPage />,
      },
      {
        path: 'forgot-password',
        element: <ForgotPasswordPage />,
      },
      {
        path: 'reset-password',
        element: <ResetPasswordPage />,
      },
      {
        path: 'email/unsubscribe',
        element: <EmailUnsubscribePage />,
      },
      {
        path: 'invite/:inviteCode',
        element: <JoinLeaguePage />,
      },
      {
        path: 'team-invite/:inviteCode',
        element: <JoinTeamOwnerPage />,
      },
      {
        path: 'join/:inviteCode',
        element: <LegacyJoinInviteRedirect />,
      },
      {
        element: <MemberRouteGuard />,
        children: [
          {
            path: 'welcome',
            element: <WelcomePage />,
          },
          {
            path: 'leagues',
            element: <Navigate replace to="/welcome" />,
          },
          {
            path: 'my-leagues',
            element: <Navigate replace to="/welcome" />,
          },
          {
            path: 'my-account',
            element: <MyAccountPage />,
          },
          {
            path: 'users/:userId',
            element: <UserPage />,
          },
          {
            path: 'league/:leagueCode',
            element: <LeagueHomePage />,
          },
          {
            path: 'league/:leagueCode/admin',
            element: <CommissionerRouteGuard />,
            children: [
              {
                element: <CommissionerToolsLayout />,
                children: [
                  {
                    index: true,
                    element: <LeagueSettingsPage />,
                  },
                  {
                    path: 'edit',
                    element: <EditLeaguePage />,
                  },
                  {
                    path: 'championships/edit',
                    element: <EditChampionshipSettingsPage />,
                  },
                  {
                    path: 'event-emails/edit',
                    element: <EditEventEmailsPage />,
                  },
                  {
                    path: 'plan/edit',
                    element: <EditLeaguePlanPage />,
                  },
                  {
                    path: 'teams',
                    element: <ManageTeamsPage />,
                  },
                  {
                    path: 'teams/:teamId',
                    element: <ManageTeamPage />,
                  },
                  {
                    path: 'teams/:teamId/edit',
                    element: <AdminEditTeamPage />,
                  },
                  {
                    path: 'invites',
                    element: <InvitesPage />,
                  },
                  {
                    path: 'contests',
                    element: <ManageContestsPage />,
                  },
                  {
                    path: 'contests/new',
                    element: <CreateContestPage />,
                  },
                  {
                    path: 'contests/:contestId',
                    element: <ManageContestPage />,
                  },
                  {
                    path: 'contests/:contestId/edit',
                    element: <EditContestPage />,
                  },
                  {
                    path: 'contests/:contestId/events',
                    element: <ContestEventsPage />,
                  },
                  {
                    path: 'contests/:contestId/cup-weight',
                    element: <EditContestCupWeightPage />,
                  },
                ],
              },
            ],
          },
          {
            path: 'league/:leagueCode/contests/new',
            element: <LegacyContestCreateRedirect />,
          },
          {
            path: 'league/:leagueCode/contests/:contestId/manage',
            element: <LegacyContestManageRedirect />,
          },
          {
            path: 'league/:leagueCode/team',
            element: <MyTeamPage />,
          },
          {
            path: 'league/:leagueCode/team/edit',
            element: <MyTeamEditPage />,
          },
          {
            path: 'league/:leagueCode/teams/:teamId',
            element: <TeamPage />,
          },
          {
            // pool-master-dxd.13 — MyEntriesPage was folded into the per-contest
            // Contest Board. Old /entries deep-links redirect to League Home.
            path: 'league/:leagueCode/entries',
            element: <LegacyLeagueEntriesRedirect />,
          },
          {
            path: 'league/:leagueCode/history',
            element: <AllYearsPage />,
          },
          {
            path: 'league/:leagueCode/teams',
            element: <TeamsPage />,
          },
          {
            path: 'league/:leagueCode/championships',
            element: <ChampionshipsRedirect />,
          },
          {
            path: 'league/:leagueCode/championships/:year',
            element: <ChampionshipsLayout />,
            children: [
              {
                index: true,
                element: <ChampionshipPage />,
              },
              {
                path: 'trophies',
                element: <TrophyCasePage />,
              },
              {
                path: 'race',
                element: <PointsRacePage />,
              },
              {
                path: 'race/:sportLeagueId',
                element: <PointsRacePage />,
              },
              {
                path: 'race/:sportLeagueId/squads/:squadId',
                element: <CupSquadPointsPage />,
              },
            ],
          },
          {
            path: 'league/:leagueCode/contest-types',
            element: <LeagueContestTypesPage />,
          },
          {
            path: 'league/:leagueCode/contests',
            element: <LeagueContestsPage />,
          },
          {
            path: 'league/:leagueCode/contests/manage',
            element: <LegacyManageContestsRedirect />,
          },
          {
            path: 'league/:leagueCode/contests/history',
            element: <LeagueContestHistoryPage />,
          },
          {
            path: 'league/:leagueCode/contests/:contestId',
            element: <ContestDetailPage />,
          },
          {
            path: 'league/:leagueCode/contests/:contestId/leaderboard',
            element: <ContestLeaderboardPage />,
          },
          {
            path: 'league/:leagueCode/contests/:contestId/entries/:entryId',
            element: <ContestEntryPage />,
          },
          {
            path: 'contests/:contestId/entries/:entryId',
            element: <ContestEntryPage />,
          },
        ],
      },
      {
        path: 'contests',
        element: <Navigate replace to="/welcome" />,
      },
      {
        // Signed-out and still-loading visitors are the member guard's; the root-admin guard
        // adds only its own check.
        element: <MemberRouteGuard />,
        children: [
          {
            element: <RootAdminRouteGuard />,
            children: [
              {
                path: 'manage',
                element: <RootAdminManageLayout />,
                children: [
                  {
                    index: true,
                    element: <ManageLandingRedirect />,
                  },
                  {
                    path: 'legacy',
                    element: <ManageLandingRedirect />,
                  },
                  {
                    path: 'content-configuration',
                    element: <RootAdminContentConfigurationListPage />,
                  },
                  {
                    path: 'content-configuration/:templateKey',
                    element: <RootAdminContentConfigurationDetailPage />,
                  },
                  {
                    path: 'events',
                    element: <RootAdminEventsPage />,
                  },
                  {
                    // Every sport's pages, one copy each (plans/racing-sports.md Q9.6).
                    path: 'sports',
                    element: <Navigate replace to={SPORTS_LANDING_PATH} />,
                  },
                  {
                    path: 'sports/:sport',
                    element: <ManageSportRoute />,
                    children: [
                      { index: true, element: <ManageSportLandingRedirect /> },
                      { path: 'leagues', element: <RootAdminSportLeagueListPage /> },
                      { path: 'leagues/new', element: <RootAdminSportLeagueCreatePage /> },
                      { path: 'leagues/:leagueId', element: <RootAdminSportLeagueHomePage /> },
                      { path: 'leagues/:leagueId/edit', element: <RootAdminSportLeagueEditPage /> },
                      { path: 'events', element: <RootAdminSportEventListPage /> },
                      { path: 'events/new', element: <RootAdminSportEventCreatePage /> },
                      {
                        path: 'events/:eventId',
                        element: <ManageSportEventRoute />,
                        children: [
                          { index: true, element: <RootAdminSportEventHomePage /> },
                          { path: 'edit', element: <RootAdminSportEventEditPage /> },
                          { path: 'schedule', element: <RootAdminSportEventSchedulePage /> },
                          { path: 'field', element: <RootAdminSportEventFieldPage /> },
                          { path: 'tiers', element: <RootAdminSportEventTiersPage /> },
                          { path: 'results', element: <RootAdminSportEventResultsPage /> },
                        ],
                      },
                      { path: 'participants', element: <RootAdminParticipantListPage /> },
                      { path: 'participants/new', element: <RootAdminParticipantCreatePage /> },
                      { path: 'participants/:participantId', element: <RootAdminParticipantHomePage /> },
                      { path: 'participants/:participantId/edit', element: <RootAdminParticipantEditPage /> },
                    ],
                  },
                  {
                    // Golf's pages before they moved under sports/golf.
                    path: 'golf/*',
                    element: <LegacyGolfManageRedirect />,
                  },
                  {
                    path: 'leagues',
                    element: <RootAdminManageLeaguesPage />,
                  },
                  {
                    path: 'users',
                    element: <RootAdminManageUsersPage />,
                  },
                  {
                    path: 'users/:userId',
                    element: <RootAdminUserPage />,
                  },
                  {
                    path: 'plans',
                    element: <RootAdminPlansPage />,
                  },
                  {
                    path: 'sync',
                    element: <RootAdminSyncDashboardPage />,
                  },
                  {
                    path: 'sync/run-event-sync',
                    element: <RootAdminRunEventSyncPage />,
                  },
                  {
                    path: 'sync/unmapped-participants',
                    element: <RootAdminUnmappedParticipantsPage />,
                  },
                  {
                    path: 'sync/unmapped-participants/map',
                    element: <RootAdminMapCompetitorPage />,
                  },
                  {
                    path: 'settings',
                    element: <RootAdminSettingsPage />,
                  },
                  {
                    path: 'settings/ingestion-schedule',
                    element: <RootAdminIngestionSchedulePage />,
                  },
                  {
                    path: 'settings/sport-overrides',
                    element: <RootAdminSportOverridesPage />,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]);
