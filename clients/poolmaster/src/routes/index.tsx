import { createBrowserRouter } from 'react-router-dom';
import { AuthHomePage } from '@/features/auth/auth-home-page';
import { AppShell } from '@/features/app-shell/app-shell';
import { PlaceholderPage } from '@/features/app-shell/placeholder-page';
import { ContestDetailPage } from '@/features/contests/contest-detail-page';
import { JoinLeaguePage } from '@/features/leagues/join-league-page';
import { LeagueDetailPage } from '@/features/leagues/league-detail-page';
import { LeaguesPage } from '@/features/leagues/leagues-page';
import { MemberRouteGuard, RootAdminRouteGuard } from './route-guards';

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
        path: 'join/:inviteCode',
        element: <JoinLeaguePage />,
      },
      {
        element: <MemberRouteGuard />,
        children: [
          {
            path: 'leagues',
            element: <LeaguesPage />,
          },
          {
            path: 'leagues/:leagueId',
            element: <LeagueDetailPage />,
          },
          {
            path: 'contests/:contestId',
            element: <ContestDetailPage />,
          },
        ],
      },
      {
        path: 'contests',
        element: (
          <PlaceholderPage
            description="Contest discovery within a league, entry creation, standings, scoring, and history will converge here."
            eyebrow="Member"
            title="Contest routes"
          />
        ),
      },
      {
        element: <RootAdminRouteGuard />,
        children: [
          {
            path: 'root-admin',
            element: (
              <PlaceholderPage
                description="Future platform administration will be rebuilt from scratch inside PoolMaster rather than through a separate app."
                eyebrow="Root Admin"
                title="Root-admin routes"
              />
            ),
          },
        ],
      },
    ],
  },
]);
