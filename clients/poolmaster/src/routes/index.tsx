import { createBrowserRouter } from 'react-router-dom';
import { AuthHomePage } from '@/features/auth/auth-home-page';
import { AppShell } from '@/features/app-shell/app-shell';
import { PlaceholderPage } from '@/features/app-shell/placeholder-page';
import { LeaguesPage } from '@/features/leagues/leagues-page';
import { MemberRouteGuard } from './route-guards';

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
        element: <MemberRouteGuard />,
        children: [
          {
            path: 'leagues',
            element: <LeaguesPage />,
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
        path: 'commissioner',
        element: (
          <PlaceholderPage
            description="Commissioner-owned contest setup, scoring-rule configuration, aggregation, and prizes will be rebuilt here."
            eyebrow="Commissioner"
            title="Commissioner routes"
          />
        ),
      },
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
]);
