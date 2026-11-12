import { Navigate, useParams } from 'react-router';
import { useAuth } from '@/features/auth/auth-context';
import { buildManageUserPath } from '@/features/root-admin/manage-navigation';
import { LoadingState } from '@/features/shared/ui';
import { MY_ACCOUNT_PATH } from './user-routing';

/**
 * `/users/:userId`: a member's own page is My account, and so is anyone else's, since members
 * never see another member's account. A root admin opening another user goes to that user in
 * Manage.
 */
export function UserPageRedirect() {
  const { user } = useAuth();
  const { userId = '' } = useParams<{ userId: string }>();

  if (!user) {
    return <LoadingState body="Loading your account..." testId="user-page-redirect-loading" />;
  }
  if (user.isRootAdmin && userId !== user.id) {
    return <Navigate replace to={buildManageUserPath(userId)} />;
  }
  return <Navigate replace to={MY_ACCOUNT_PATH} />;
}
