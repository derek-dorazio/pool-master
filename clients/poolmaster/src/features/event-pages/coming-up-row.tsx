import { useMemo } from 'react';
import { Link } from 'react-router';
import { buildEventPagePath, type Sport } from '@poolmaster/shared/domain';
import { SectionHeader, Tile } from '@/features/shared/ui';
import { eventPageCopy, eventPageOfferCopy, formatStartsIn } from './event-page-copy';
import { upcomingEventPages } from './event-page-offers';
import { useEventPagesQuery } from './use-event-pages-query';

/** Where a sport's or every sport's Coming up row stops: with every sport, the next three. */
const ALL_SPORTS_LIMIT = 3;

/**
 * How to Play's and the welcome page's Coming up row (#1007, board 4): a card per event page with
 * an edition coming, saying when, its contest types, and linking to the page. Nothing while the
 * pages load, fail or have nothing coming: the row is a way in, never in the way.
 */
export function ComingUpRow({ sport, testId = 'coming-up' }: { sport?: Sport; testId?: string }) {
  const pagesQuery = useEventPagesQuery(sport);
  const now = useMemo(() => new Date(), []);
  const upcoming = upcomingEventPages(pagesQuery.data ?? []).slice(0, sport ? undefined : ALL_SPORTS_LIMIT);
  if (upcoming.length === 0) {
    return null;
  }
  return (
    <section className="space-y-3" data-testid={testId}>
      <SectionHeader title="Coming up" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {upcoming.map(({ page, primary }, index) => {
          const copy = eventPageCopy(page);
          return (
            <Link
              className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`${testId}-${page.slug}`}
              key={page.id}
              to={buildEventPagePath(page.sport, page.slug)}
            >
              <Tile className={index === 0 ? 'h-full space-y-2 border-primary' : 'h-full space-y-2'} padding="md" radius="md" variant="interactive">
                <p className="text-xs font-semibold uppercase text-muted-foreground">{formatStartsIn(primary.edition.startDate, now)}</p>
                <h3 className="font-display text-xl font-bold text-foreground">{copy.name}</h3>
                <p className="text-sm text-muted-foreground">{page.offers.map((offer) => eventPageOfferCopy(copy, offer).contestType).join(' · ')}</p>
                <p className="text-sm font-semibold text-foreground">See ways to play ›</p>
              </Tile>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
