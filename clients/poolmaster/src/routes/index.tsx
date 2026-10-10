import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthHomePage } from '@/features/auth/auth-home-page';
import { MyAccountPage } from '@/features/account/my-account-page';
import { UserPage } from '@/features/account/user-page';
import { AppShell } from '@/features/app-shell/app-shell';
import { NotFoundPage } from '@/features/app-shell/not-found-page';
import { CreateContestPage } from '@/features/contests/create-contest-page';
import { ContestDetailPage } from '@/features/contests/contest-detail-page';
import { ContestEntryPage } from '@/features/contests/contest-entry-page';
import { ContestLeaderboardPage } from '@/features/contests/contest-leaderboard-page';
import { LeagueContestHistoryPage } from '@/features/contests/league-contest-history-page';
import { LeagueContestsPage } from '@/features/contests/league-contests-page';
import { ManageContestsPage } from '@/features/contests/manage-contests-page';
import { JoinLeaguePage } from '@/features/leagues/join-league-page';
import { CommissionerToolsLayout } from '@/features/leagues/commissioner-tools-layout';
import { EditLeaguePage } from '@/features/leagues/edit-league-page';
import { LeagueHomePage } from '@/features/leagues/league-home-page';
import { LeagueSettingsPage } from '@/features/leagues/league-settings-page';
import { WelcomePage } from '@/features/leagues/leagues-page';
import { RootAdminContentConfigurationDetailPage } from '@/features/root-admin/root-admin-content-configuration-detail-page';
import { RootAdminContentConfigurationListPage } from '@/features/root-admin/root-admin-content-configuration-list-page';
import { RootAdminEventsPage } from '@/features/root-admin/root-admin-events-page';
import { RootAdminGolfHubPage } from '@/features/root-admin/root-admin-golf-hub-page';
import { RootAdminGolfLeagueHomePage } from '@/features/root-admin/root-admin-golf-league-home-page';
import { RootAdminGolfPlayerHomePage } from '@/features/root-admin/root-admin-golf-player-home-page';
import { RootAdminGolfPlayerListPage } from '@/features/root-admin/root-admin-golf-player-list-page';
import { RootAdminGolfLeagueListPage } from '@/features/root-admin/root-admin-golf-league-list-page';
import { RootAdminGolfTournamentCreatePage } from '@/features/root-admin/root-admin-golf-tournament-create-page';
import { RootAdminGolfTournamentFieldPage } from '@/features/root-admin/root-admin-golf-tournament-field-page';
import { RootAdminGolfTournamentHomePage } from '@/features/root-admin/root-admin-golf-tournament-home-page';
import { RootAdminGolfTournamentTiersPage } from '@/features/root-admin/root-admin-golf-tournament-tiers-page';
import { RootAdminGolfTournamentListPage } from '@/features/root-admin/root-admin-golf-tournament-list-page';
import { RootAdminGolfTournamentScoresPage } from '@/features/root-admin/root-admin-golf-tournament-scores-page';
import { RootAdminIngestionSchedulePage } from '@/features/root-admin/root-admin-ingestion-schedule-page';
import { ManageLandingRedirect, RootAdminManageLayout } from '@/features/root-admin/root-admin-manage-layout';
import { RootAdminManageLeaguesPage } from '@/features/root-admin/root-admin-manage-leagues-page';
import { RootAdminManageUsersPage } from '@/features/root-admin/root-admin-manage-users-page';
import { RootAdminUserPage } from '@/features/root-admin/root-admin-user-page';
import { RootAdminRunEventSyncPage } from '@/features/root-admin/root-admin-run-event-sync-page';
import { RootAdminSportOverridesPage } from '@/features/root-admin/root-admin-sport-overrides-page';
import { RootAdminSyncConfigPage } from '@/features/root-admin/root-admin-sync-config-page';
import { RootAdminSettingsPage } from '@/features/root-admin/root-admin-settings-page';
import { RootAdminSyncDashboardPage } from '@/features/root-admin/root-admin-sync-dashboard-page';
import { RootAdminUnmappedParticipantsPage } from '@/features/root-admin/root-admin-unmapped-participants-page';
import { JoinTeamOwnerPage } from '@/features/teams/join-team-owner-page';
import { MyTeamHistoryPage } from '@/features/teams/my-team-history-page';
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
                    element: <CreateContestPage />,
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
            element: <MyTeamHistoryPage />,
          },
          {
            path: 'league/:leagueCode/teams',
            element: <TeamsPage />,
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
                    path: 'golf',
                    element: <RootAdminGolfHubPage />,
                  },
                  {
                    path: 'golf/leagues',
                    element: <RootAdminGolfLeagueListPage />,
                  },
                  {
                    path: 'golf/leagues/:leagueId',
                    element: <RootAdminGolfLeagueHomePage />,
                  },
                  {
                    path: 'golf/tournaments',
                    element: <RootAdminGolfTournamentListPage />,
                  },
                  {
                    path: 'golf/tournaments/new',
                    element: <RootAdminGolfTournamentCreatePage />,
                  },
                  {
                    path: 'golf/tournaments/:eventId',
                    element: <RootAdminGolfTournamentHomePage />,
                  },
                  {
                    path: 'golf/tournaments/:eventId/field',
                    element: <RootAdminGolfTournamentFieldPage />,
                  },
                  {
                    path: 'golf/tournaments/:eventId/tiers',
                    element: <RootAdminGolfTournamentTiersPage />,
                  },
                  {
                    path: 'golf/tournaments/:eventId/scores',
                    element: <RootAdminGolfTournamentScoresPage />,
                  },
                  {
                    path: 'golf/players',
                    element: <RootAdminGolfPlayerListPage />,
                  },
                  {
                    path: 'golf/players/:participantId',
                    element: <RootAdminGolfPlayerHomePage />,
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
                    path: 'settings',
                    element: <RootAdminSettingsPage />,
                  },
                  {
                    path: 'sync-config',
                    element: <RootAdminSyncConfigPage />,
                  },
                  {
                    path: 'sync-config/ingestion-schedule',
                    element: <RootAdminIngestionSchedulePage />,
                  },
                  {
                    path: 'sync-config/sport-overrides',
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
