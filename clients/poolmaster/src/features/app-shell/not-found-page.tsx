import { useEffect } from 'react';
import { Link } from 'react-router';
import { getLogger } from '@/lib/logger';
import { Heading, Text } from '@/features/shared/ui';

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
      <Text variant="label">Not Found</Text>
      <div className="mt-4 space-y-3">
        <Heading level={2} tone="inherit" variant="page">We couldn&apos;t find that page.</Heading>
        <Text as="p" className="max-w-2xl leading-7" size="base" variant="meta">
          Try returning to your welcome route or use the league selector once you&apos;re signed in.
        </Text>
        <Text asChild tone="primary" variant="strong">
          <Link className="inline-flex hover:underline" to="/">
            Back to sign in
          </Link>
        </Text>
      </div>
    </section>
  );
}
