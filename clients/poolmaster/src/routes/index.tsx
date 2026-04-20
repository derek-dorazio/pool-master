import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import { AuthHomePage } from '@/features/auth/auth-home-page';
import { MyAccountPage } from '@/features/account/my-account-page';
import { AppShell } from '@/features/app-shell/app-shell';
import { NotFoundPage } from '@/features/app-shell/not-found-page';
import { CreateContestPage } from '@/features/contests/create-contest-page';
import { ContestDetailPage } from '@/features/contests/contest-detail-page';
import { ContestEntryPage } from '@/features/contests/contest-entry-page';
import { JoinLeaguePage } from '@/features/leagues/join-league-page';
import { LeagueDetailPage } from '@/features/leagues/league-detail-page';
import { MyLeaguesPage, WelcomePage } from '@/features/leagues/leagues-page';
import { RootAdminPage } from '@/features/root-admin/root-admin-page';
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
            path: 'league/:leagueCode/teams',
            element: <TeamsPage />,
          },
          {
            path: 'contests/:contestId',
            element: <ContestDetailPage />,
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
            path: 'root-admin',
            element: <RootAdminPage />,
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
