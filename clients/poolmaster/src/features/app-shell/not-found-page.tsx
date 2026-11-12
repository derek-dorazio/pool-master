import { useEffect, useMemo } from 'react';
import { getLogger } from '@/lib/logger';
import { useAuth } from '@/features/auth/auth-context';
import { LinkButton, StatusPage } from '@/features/shared/ui';

export function NotFoundPage() {
  const logger = useMemo(() => getLogger().child({ feature: 'not-found-page' }), []);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    logger.info({ action: 'route.notFound.loaded' }, 'Rendered not-found route');
  }, [logger]);

  return (
    <StatusPage
      action={isAuthenticated ? (
        <LinkButton data-testid="not-found-action" to="/welcome">Go to my leagues</LinkButton>
      ) : (
        <LinkButton data-testid="not-found-action" to="/">Sign in</LinkButton>
      )}
      body="The link may be old or mistyped."
      kind="notFound"
      testId="not-found-page"
      title="Page not found"
    />
  );
}
