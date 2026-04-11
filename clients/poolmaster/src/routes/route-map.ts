export type PoolmasterRole = 'PUBLIC' | 'MEMBER' | 'ROOT_ADMIN';

export type RouteMapItem = {
  path: string;
  label: string;
  role: PoolmasterRole;
  description: string;
};

export const routeMap: RouteMapItem[] = [
  {
    path: '/',
    label: 'Auth',
    role: 'PUBLIC',
    description: 'Entry point for the rebuilt PoolMaster web app.',
  },
  {
    path: '/welcome',
    label: 'Welcome',
    role: 'MEMBER',
    description: 'Zero-league authenticated home and create-league entry point.',
  },
  {
    path: '/league/:leagueCode',
    label: 'League Home',
    role: 'MEMBER',
    description: 'League-scoped home route for members and commissioners.',
  },
  {
    path: '/contests',
    label: 'Contests',
    role: 'MEMBER',
    description: 'Contest browsing, entry creation, standings, and history.',
  },
  {
    path: '/root-admin',
    label: 'Root Admin',
    role: 'ROOT_ADMIN',
    description: 'Future platform-level administrative tools rebuilt inside PoolMaster.',
  },
];
