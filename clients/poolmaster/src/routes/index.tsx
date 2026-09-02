import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import { AuthHomePage } from '@/features/auth/auth-home-page';
import { MyAccountPage } from '@/features/account/my-account-page';
import { UserPage } from '@/features/account/user-page';
import { AppShell } from '@/features/app-shell/app-shell';
import { NotFoundPage } from '@/features/app-shell/not-found-page';
import { CreateContestPage } from '@/features/contests/create-contest-page';
import { ContestDetailPage } from '@/features/contests/contest-detail-page';
import { ContestEntryPage } from '@/features/contests/contest-entry-page';
import { LeagueContestHistoryPage } from '@/features/contests/league-contest-history-page';
import { LeagueContestsPage } from '@/features/contests/league-contests-page';
import { ManageContestsPage } from '@/features/contests/manage-contests-page';
import { JoinLeaguePage } from '@/features/leagues/join-league-page';
import { LeagueDetailPage } from '@/features/leagues/league-detail-page';
import { WelcomePage } from '@/features/leagues/leagues-page';
import { RootAdminContentConfigurationDetailPage } from '@/features/root-admin/root-admin-content-configuration-detail-page';
import { RootAdminContentConfigurationListPage } from '@/features/root-admin/root-admin-content-configuration-list-page';
import { RootAdminEventsPage } from '@/features/root-admin/root-admin-events-page';
import { RootAdminGolfHubPage } from '@/features/root-admin/root-admin-golf-hub-page';
import { RootAdminGolfLeagueHomePage } from '@/features/root-admin/root-admin-golf-league-home-page';
import { RootAdminGolfPlayerHomePage } from '@/features/root-admin/root-admin-golf-player-home-page';
import { RootAdminGolfPlayerListPage } from '@/features/root-admin/root-admin-golf-player-list-page';
import { RootAdminGolfLeagueListPage } from '@/features/root-admin/root-admin-golf-league-list-page';
import { RootAdminGolfSeasonHomePage } from '@/features/root-admin/root-admin-golf-season-home-page';
import { RootAdminGolfSeasonListPage } from '@/features/root-admin/root-admin-golf-season-list-page';
import { RootAdminGolfTournamentCreatePage } from '@/features/root-admin/root-admin-golf-tournament-create-page';
import { RootAdminGolfTournamentFieldPage } from '@/features/root-admin/root-admin-golf-tournament-field-page';
import { RootAdminGolfTournamentHomePage } from '@/features/root-admin/root-admin-golf-tournament-home-page';
import { RootAdminGolfTournamentTiersPage } from '@/features/root-admin/root-admin-golf-tournament-tiers-page';
import { RootAdminGolfTournamentListPage } from '@/features/root-admin/root-admin-golf-tournament-list-page';
import { RootAdminGolfTournamentScoresPage } from '@/features/root-admin/root-admin-golf-tournament-scores-page';
import { RootAdminIngestionSchedulePage } from '@/features/root-admin/root-admin-ingestion-schedule-page';
import { RootAdminManageHubPage } from '@/features/root-admin/root-admin-manage-hub-page';
import { RootAdminManageLayout } from '@/features/root-admin/root-admin-manage-layout';
import { RootAdminManageLeaguesPage } from '@/features/root-admin/root-admin-manage-leagues-page';
import { RootAdminManageTeamsPage } from '@/features/root-admin/root-admin-manage-teams-page';
import { RootAdminManageUsersPage } from '@/features/root-admin/root-admin-manage-users-page';
import { RootAdminPollIntervalsPage } from '@/features/root-admin/root-admin-poll-intervals-page';
import { RootAdminRunEventSyncPage } from '@/features/root-admin/root-admin-run-event-sync-page';
import { RootAdminRunSportSyncPage } from '@/features/root-admin/root-admin-run-sport-sync-page';
import { RootAdminSportOverridesPage } from '@/features/root-admin/root-admin-sport-overrides-page';
import { RootAdminSyncConfigPage } from '@/features/root-admin/root-admin-sync-config-page';
import { RootAdminSyncDashboardPage } from '@/features/root-admin/root-admin-sync-dashboard-page';
import { CanonicalTeamHomeRoute } from '@/features/teams/canonical-team-home-route';
import { JoinTeamOwnerPage } from '@/features/teams/join-team-owner-page';
import { MyTeamHistoryPage } from '@/features/teams/my-team-history-page';
import { MyTeamPage } from '@/features/teams/my-team-page';
import { TeamsPage } from '@/features/teams/teams-page';
import { MemberRouteGuard, RootAdminRouteGuard } from './route-guards';

function LegacyJoinInviteRedirect() {
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();
  return <Navigate replace to={`/invite/${inviteCode}`} />;
}

function LegacyLeagueEntriesRedirect() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  return <Navigate replace to={`/league/${leagueCode}`} />;
}

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
            element: <LeagueDetailPage />,
          },
          {
            path: 'league/:leagueCode/contests/new',
            element: <CreateContestPage />,
          },
          {
            path: 'league/:leagueCode/contests/:contestId/manage',
            element: <CreateContestPage />,
          },
          {
            path: 'league/:leagueCode/team',
            element: <MyTeamPage />,
          },
          {
            path: 'league/:leagueCode/teams/:teamId',
            element: <CanonicalTeamHomeRoute />,
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
            element: <ManageContestsPage />,
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
        element: <RootAdminRouteGuard />,
        children: [
          {
            path: 'manage',
            element: <RootAdminManageLayout />,
            children: [
              {
                index: true,
                element: <RootAdminManageHubPage />,
              },
              {
                path: 'legacy',
                element: <Navigate replace to="/manage" />,
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
                path: 'golf/seasons',
                element: <RootAdminGolfSeasonListPage />,
              },
              {
                path: 'golf/seasons/:seasonId',
                element: <RootAdminGolfSeasonHomePage />,
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
                path: 'teams',
                element: <RootAdminManageTeamsPage />,
              },
              {
                path: 'users',
                element: <RootAdminManageUsersPage />,
              },
              {
                path: 'sync',
                element: <RootAdminSyncDashboardPage />,
              },
              {
                path: 'sync/run-sport-sync',
                element: <RootAdminRunSportSyncPage />,
              },
              {
                path: 'sync/run-event-sync',
                element: <RootAdminRunEventSyncPage />,
              },
              {
                path: 'sync-config',
                element: <RootAdminSyncConfigPage />,
              },
              {
                path: 'sync-config/poll-intervals',
                element: <RootAdminPollIntervalsPage />,
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
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]);
