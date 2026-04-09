import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-provider';

export function MemberRouteGuard() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isLoading) {
    return (
      <div className="rounded-[2rem] border border-border bg-card p-8 text-sm text-muted-foreground">
        Loading your PoolMaster session...
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <Navigate replace state={{ from: location.pathname }} to="/" />;
  }

  return <Outlet />;
}
