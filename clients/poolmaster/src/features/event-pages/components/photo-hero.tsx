import type { ReactNode } from 'react';
import { sportHeaderImagePath } from '@poolmaster/shared/domain';
import { Tile } from '@/features/shared/ui';

/**
 * An event page's hero: the sport's photo, the same file that heads the email about its events,
 * over the page's name, hook and start button.
 */
export function PhotoHero({ children, sportUrlSegment }: { children: ReactNode; sportUrlSegment: string }) {
  return (
    <Tile className="overflow-hidden" padding="none" radius="panel">
      {/* Decorative: the name below says what it shows. */}
      <img alt="" className="aspect-[5/2] w-full object-cover" data-testid="event-page-photo" height={480} src={sportHeaderImagePath(sportUrlSegment)} width={1200} />
      <div className="space-y-4 p-5 sm:p-8">{children}</div>
    </Tile>
  );
}
