import { createBrowserRouter } from 'react-router-dom';
import { PublicLayout } from '@/components/layouts/public-layout';
import { AuthenticatedLayout } from '@/components/layouts/authenticated-layout';
import { FullscreenLayout } from '@/components/layouts/fullscreen-layout';
import { NotFoundPage } from '@/pages/not-found';

export const router = createBrowserRouter([
  // Public routes
  {
    element: <PublicLayout />,
    children: [
      { index: true, lazy: () => import('@/pages/landing') },
      { path: 'login', lazy: () => import('@/pages/auth/login') },
      { path: 'register', lazy: () => import('@/pages/auth/register') },
      { path: 'forgot-password', lazy: () => import('@/pages/auth/forgot-password') },
      { path: 'callback', lazy: () => import('@/pages/auth/callback') },
      { path: 'privacy', lazy: () => import('@/pages/legal/privacy') },
      { path: 'terms', lazy: () => import('@/pages/legal/terms') },
      { path: 'responsible-gaming', lazy: () => import('@/pages/legal/responsible-gaming') },
      { path: 'cookie-policy', lazy: () => import('@/pages/legal/cookie-policy') },
      { path: 'share/:shareId', lazy: () => import('@/pages/share') },
    ],
  },

  // Authenticated routes
  {
    element: <AuthenticatedLayout />,
    children: [
      { path: 'dashboard', lazy: () => import('@/pages/dashboard') },
      { path: 'notifications', lazy: () => import('@/pages/notifications') },

      // Leagues
      { path: 'leagues', lazy: () => import('@/pages/leagues') },
      { path: 'leagues/create', lazy: () => import('@/pages/leagues/create') },
      { path: 'leagues/:leagueId', lazy: () => import('@/pages/leagues/detail') },
      { path: 'leagues/:leagueId/settings', lazy: () => import('@/pages/leagues/settings') },
      { path: 'leagues/:leagueId/members', lazy: () => import('@/pages/leagues/members') },
      { path: 'leagues/:leagueId/feed', lazy: () => import('@/pages/leagues/feed') },
      { path: 'leagues/:leagueId/records', lazy: () => import('@/pages/leagues/records') },
      { path: 'leagues/:leagueId/history', lazy: () => import('@/pages/leagues/history') },
      { path: 'leagues/:leagueId/recap', lazy: () => import('@/pages/leagues/recap') },

      // Contests
      { path: 'contests/create', lazy: () => import('@/pages/contests/create') },
      { path: 'contests/:contestId', lazy: () => import('@/pages/contests/detail') },
      { path: 'contests/:contestId/standings', lazy: () => import('@/pages/contests/standings') },
      { path: 'contests/:contestId/scoring', lazy: () => import('@/pages/contests/scoring') },
      { path: 'contests/:contestId/results', lazy: () => import('@/pages/contests/results') },
      { path: 'contests/:contestId/head-to-head', lazy: () => import('@/pages/contests/head-to-head') },

      // Discovery
      { path: 'discover', lazy: () => import('@/pages/discover') },
      { path: 'discover/leagues', lazy: () => import('@/pages/discover/leagues') },
      { path: 'discover/contests', lazy: () => import('@/pages/discover/contests') },
      { path: 'discover/search', lazy: () => import('@/pages/discover/search') },

      // Settings
      { path: 'settings', lazy: () => import('@/pages/settings') },
      { path: 'settings/profile', lazy: () => import('@/pages/settings/profile') },
      { path: 'settings/notifications', lazy: () => import('@/pages/settings/notifications') },
      { path: 'settings/timezone', lazy: () => import('@/pages/settings/timezone') },
      { path: 'settings/privacy', lazy: () => import('@/pages/settings/privacy') },

      // Billing
      { path: 'billing', lazy: () => import('@/pages/billing') },
      { path: 'billing/plans', lazy: () => import('@/pages/billing/plans') },
      { path: 'billing/invoices', lazy: () => import('@/pages/billing/invoices') },
    ],
  },

  // Fullscreen routes (draft room)
  {
    element: <FullscreenLayout />,
    children: [
      { path: 'drafts/:draftId', lazy: () => import('@/pages/drafts/room') },
      { path: 'drafts/:draftId/results', lazy: () => import('@/pages/drafts/results') },
    ],
  },

  // 404
  { path: '*', element: <NotFoundPage /> },
]);
