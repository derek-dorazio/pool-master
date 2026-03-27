/**
 * RoleGuard — restricts access to pages based on the user's league role.
 * Wraps route content; redirects non-authorized users with a toast.
 */

import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

type LeagueRole = 'OWNER' | 'COMMISSIONER' | 'MANAGER' | 'VIEWER';

interface RoleGuardProps {
  /** Minimum roles that have access (checked in order: OWNER > COMMISSIONER > MANAGER > VIEWER) */
  allowedRoles: LeagueRole[];
  /** Where to redirect if the user doesn't have access */
  redirectTo?: string;
  children: React.ReactNode;
}

const ROLE_HIERARCHY: LeagueRole[] = ['OWNER', 'COMMISSIONER', 'MANAGER', 'VIEWER'];

function useMyLeagueRole(leagueId: string) {
  const user = useAuthStore((s) => s.user);

  return useQuery({
    queryKey: ['leagues', leagueId, 'my-role'],
    queryFn: async (): Promise<LeagueRole> => {
      // TODO: Replace with real API
      // const membership = await api.get(`/v1/leagues/${leagueId}/members/me`);
      // return membership.role;
      await new Promise((r) => setTimeout(r, 100));
      return 'COMMISSIONER'; // mock
    },
    enabled: !!user,
  });
}

export function RoleGuard({ allowedRoles, redirectTo, children }: RoleGuardProps) {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const { data: role, isLoading } = useMyLeagueRole(leagueId!);

  const hasAccess = role ? allowedRoles.includes(role) : false;

  useEffect(() => {
    if (!isLoading && !hasAccess) {
      navigate(redirectTo ?? `/leagues/${leagueId}`, { replace: true });
    }
  }, [isLoading, hasAccess, navigate, redirectTo, leagueId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!hasAccess) return null;

  return <>{children}</>;
}

/**
 * Higher-order component version for wrapping entire route components.
 */
export function withRoleGuard(
  Component: React.ComponentType,
  allowedRoles: LeagueRole[],
  redirectTo?: string,
) {
  return function GuardedComponent() {
    return (
      <RoleGuard allowedRoles={allowedRoles} redirectTo={redirectTo}>
        <Component />
      </RoleGuard>
    );
  };
}
