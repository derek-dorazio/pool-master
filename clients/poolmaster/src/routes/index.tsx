import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/features/app-shell/app-shell';
import { PlaceholderPage } from '@/features/app-shell/placeholder-page';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: (
          <PlaceholderPage
            description="This scaffold is the foundation for the single go-forward frontend for members, commissioners, and root admins."
            eyebrow="PoolMaster"
            title="The new role-based PoolMaster web app starts here."
          />
        ),
      },
      {
        path: 'leagues',
        element: (
          <PlaceholderPage
            description="League browsing, invitation acceptance, dashboards, and squad-aware workflows will live here first."
            eyebrow="Member"
            title="League routes"
          />
        ),
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
