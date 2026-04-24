import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import { AuthHomePage } from '@/features/auth/auth-home-page';
import { MyAccountPage } from '@/features/account/my-account-page';
import { AppShell } from '@/features/app-shell/app-shell';
import { NotFoundPage } from '@/features/app-shell/not-found-page';
import { CreateContestPage } from '@/features/contests/create-contest-page';
import { ContestDetailPage } from '@/features/contests/contest-detail-page';
import { ContestEntryPage } from '@/features/contests/contest-entry-page';
import { LegacyContestDetailRedirect } from '@/features/contests/legacy-contest-detail-redirect';
import { JoinLeaguePage } from '@/features/leagues/join-league-page';
import { LeagueDetailPage } from '@/features/leagues/league-detail-page';
import { LeagueRouteScaffoldPage } from '@/features/leagues/league-route-scaffold-page';
import { MyLeaguesPage, WelcomePage } from '@/features/leagues/leagues-page';
import { RootAdminContentConfigurationDetailPage } from '@/features/root-admin/root-admin-content-configuration-detail-page';
import { RootAdminContentConfigurationListPage } from '@/features/root-admin/root-admin-content-configuration-list-page';
import { RootAdminIngestionSchedulePage } from '@/features/root-admin/root-admin-ingestion-schedule-page';
import { RootAdminManageHubPage } from '@/features/root-admin/root-admin-manage-hub-page';
import { RootAdminManageLayout } from '@/features/root-admin/root-admin-manage-layout';
import { RootAdminManageScaffoldPage } from '@/features/root-admin/root-admin-manage-scaffold-page';
import { RootAdminPage } from '@/features/root-admin/root-admin-page';
import { RootAdminPollIntervalsPage } from '@/features/root-admin/root-admin-poll-intervals-page';
import { RootAdminRunEventSyncPage } from '@/features/root-admin/root-admin-run-event-sync-page';
import { RootAdminRunSportSyncPage } from '@/features/root-admin/root-admin-run-sport-sync-page';
import { RootAdminSportOverridesPage } from '@/features/root-admin/root-admin-sport-overrides-page';
import { RootAdminSyncConfigPage } from '@/features/root-admin/root-admin-sync-config-page';
import { RootAdminSyncDashboardPage } from '@/features/root-admin/root-admin-sync-dashboard-page';
import { CanonicalTeamHomeRoute } from '@/features/teams/canonical-team-home-route';
import { JoinTeamOwnerPage } from '@/features/teams/join-team-owner-page';
import { MyTeamPage } from '@/features/teams/my-team-page';
import { TeamsPage } from '@/features/teams/teams-page';
import { MemberRouteGuard, RootAdminRouteGuard } from './route-guards';

function LegacyJoinInviteRedirect() {
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();
  return <Navigate replace to={`/invite/${inviteCode}`} />;
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
            element: <Navigate replace to="/my-leagues" />,
          },
          {
            path: 'my-leagues',
            element: <MyLeaguesPage />,
          },
          {
            path: 'my-account',
            element: <MyAccountPage />,
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
            path: 'league/:leagueCode/entries',
            element: <LeagueRouteScaffoldPage scaffoldKey="entries" />,
          },
          {
            path: 'league/:leagueCode/history',
            element: <LeagueRouteScaffoldPage scaffoldKey="history" />,
          },
          {
            path: 'league/:leagueCode/teams',
            element: <TeamsPage />,
          },
          {
            path: 'league/:leagueCode/contests',
            element: <LeagueRouteScaffoldPage scaffoldKey="contests" />,
          },
          {
            path: 'league/:leagueCode/contests/manage',
            element: <LeagueRouteScaffoldPage scaffoldKey="manage-contests" />,
          },
          {
            path: 'league/:leagueCode/contests/:contestId',
            element: <ContestDetailPage />,
          },
          {
            path: 'contests/:contestId',
            element: <LegacyContestDetailRedirect />,
          },
          {
            path: 'contests/:contestId/entries/:entryId',
            element: <ContestEntryPage />,
          },
        ],
      },
      {
        path: 'contests',
        element: <Navigate replace to="/my-leagues" />,
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
                element: <RootAdminPage />,
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
                path: 'leagues',
                element: <RootAdminManageScaffoldPage sectionKey="leagues" />,
              },
              {
                path: 'teams',
                element: <RootAdminManageScaffoldPage sectionKey="teams" />,
              },
              {
                path: 'users',
                element: <RootAdminManageScaffoldPage sectionKey="users" />,
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
