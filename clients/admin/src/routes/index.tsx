import { createBrowserRouter } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/admin-layout';
import { AdminLoginLayout } from '@/components/layouts/admin-login-layout';

export const router = createBrowserRouter(
  [
    {
      element: <AdminLoginLayout />,
      children: [
        {
          path: 'login',
          lazy: () => import('@/pages/login'),
        },
      ],
    },
    {
      element: <AdminLayout />,
      children: [
        {
          index: true,
          lazy: () => import('@/pages/home'),
        },
        {
          path: 'tenants',
          lazy: () => import('@/pages/tenants/index'),
        },
        {
          path: 'tenants/:tenantId',
          lazy: () => import('@/pages/tenants/detail'),
        },
        {
          path: 'users',
          lazy: () => import('@/pages/users/index'),
        },
        {
          path: 'users/:userId',
          lazy: () => import('@/pages/users/detail'),
        },
        {
          path: 'users/merge',
          lazy: () => import('@/pages/users/merge'),
        },
        {
          path: 'contests',
          lazy: () => import('@/pages/contests/index'),
        },
        {
          path: 'contests/:contestId',
          lazy: () => import('@/pages/contests/detail'),
        },
        {
          path: 'providers',
          lazy: () => import('@/pages/providers/index'),
        },
        {
          path: 'providers/:providerId',
          lazy: () => import('@/pages/providers/detail'),
        },
        {
          path: 'providers/ingestion',
          lazy: () => import('@/pages/providers/ingestion'),
        },
        {
          path: 'flags',
          lazy: () => import('@/pages/flags/index'),
        },
        {
          path: 'flags/:flagKey',
          lazy: () => import('@/pages/flags/detail'),
        },
        {
          path: 'health',
          lazy: () => import('@/pages/health/index'),
        },
        {
          path: 'health/errors',
          lazy: () => import('@/pages/health/errors'),
        },
        {
          path: 'health/alerts',
          lazy: () => import('@/pages/health/alerts'),
        },
        {
          path: 'audit',
          lazy: () => import('@/pages/audit/index'),
        },
        {
          path: 'announcements',
          lazy: () => import('@/pages/announcements/index'),
        },
        {
          path: 'announcements/create',
          lazy: () => import('@/pages/announcements/create'),
        },
        {
          path: 'migrations',
          lazy: () => import('@/pages/migrations/index'),
        },
        {
          path: 'migrations/:runId',
          lazy: () => import('@/pages/migrations/detail'),
        },
        {
          path: 'config',
          lazy: () => import('@/pages/config/index'),
        },
        {
          path: 'config/templates',
          lazy: () => import('@/pages/config/templates'),
        },
        {
          path: 'config/notifications',
          lazy: () => import('@/pages/config/notifications'),
        },
        {
          path: 'config/platform',
          lazy: () => import('@/pages/config/platform'),
        },
      ],
    },
  ],
);
