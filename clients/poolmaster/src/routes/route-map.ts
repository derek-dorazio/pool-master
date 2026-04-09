export type PoolmasterRole = 'PUBLIC' | 'MEMBER' | 'COMMISSIONER' | 'ROOT_ADMIN';

export type RouteMapItem = {
  path: string;
  label: string;
  role: PoolmasterRole;
  description: string;
};

export const routeMap: RouteMapItem[] = [
  {
    path: '/',
    label: 'Home',
    role: 'PUBLIC',
    description: 'Entry point for the rebuilt PoolMaster web app.',
  },
  {
    path: '/leagues',
    label: 'Leagues',
    role: 'MEMBER',
    description: 'Member-facing league list and league home surface.',
  },
  {
    path: '/contests',
    label: 'Contests',
    role: 'MEMBER',
    description: 'Contest browsing, entry creation, standings, and history.',
  },
  {
    path: '/commissioner',
    label: 'Commissioner',
    role: 'COMMISSIONER',
    description: 'League-owned contest and roster management surface.',
  },
  {
    path: '/root-admin',
    label: 'Root Admin',
    role: 'ROOT_ADMIN',
    description: 'Future platform-level administrative tools rebuilt inside PoolMaster.',
  },
];
