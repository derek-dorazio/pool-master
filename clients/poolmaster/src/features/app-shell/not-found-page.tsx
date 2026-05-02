import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getLogger } from '@/lib/logger';

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
    <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
      <span className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
        Not Found
      </span>
      <div className="mt-4 space-y-3">
        <h2 className="text-3xl font-semibold tracking-tight">We couldn&apos;t find that page.</h2>
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
