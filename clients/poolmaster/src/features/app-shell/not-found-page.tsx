import { useEffect } from 'react';
import { Link } from 'react-router';
import { getLogger } from '@/lib/logger';
import { Heading } from '@/features/shared/ui';

export function NotFoundPage() {
  const logger = getLogger().child({
    feature: 'not-found-page',
  });

  useEffect(() => {
    logger.info(
      {
        action: 'route.notFound.loaded',
      },
      'Rendered not-found route',
    );
  }, [logger]);

  return (
    <section
      className="rounded-4xl border border-border bg-card p-8 shadow-sm"
      data-testid="not-found-page"
    >
      <span className="text-xs font-medium uppercase text-muted-foreground">
        Not Found
      </span>
      <div className="mt-4 space-y-3">
        <Heading level={2} tone="inherit" variant="page">We couldn&apos;t find that page.</Heading>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">
          Try returning to your welcome route or use the league selector once you&apos;re signed in.
        </p>
        <Link className="inline-flex text-sm font-medium text-primary hover:underline" to="/">
          Back to sign in
        </Link>
      </div>
    </section>
  );
}
