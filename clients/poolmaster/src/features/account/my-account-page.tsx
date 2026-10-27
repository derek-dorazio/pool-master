import { Navigate } from 'react-router';
import { useAuth } from '@/features/auth/auth-context';
import { buildUserPath } from './user-routing';

export function MyAccountPage() {
  const auth = useAuth();

  if (auth.isLoading) {
    return null;
  }

  if (!auth.user?.id) {
    return <Navigate replace to="/" />;
  }

  return <Navigate replace to={buildUserPath(auth.user.id)} />;
}
