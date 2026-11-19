import type { ReactNode } from 'react';
import { PageHeader, PageTabs } from '@/features/shared/ui';
import { buildSportEventListPath, buildSportParticipantListPath } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';
import { upperFirst } from '@/lib/upper-first';

const SPORT_LISTS = ['events', 'participants'] as const;

type SportList = (typeof SPORT_LISTS)[number];

/**
 * The header of a sport's two lists: the sport's name as the title and tabs between the lists,
 * named in its own words (golf: Tournaments, Golfers), so no list's name shows twice. The
 * sport's own tab sits in the area's second row, under Sports.
 */
export function SportSectionMenu({
  actions,
  current,
  tabsEnd,
}: {
  /** The list's one page action, such as New tournament. */
  actions?: ReactNode;
  current: SportList;
  /** A filter for the whole list, such as its year, at the tab row's right end. */
  tabsEnd?: ReactNode;
}) {
  const { sport, definition } = useManagedSport();
  const { event, participant } = definition.vocabulary;
  const lists: Record<SportList, { label: string; path: string }> = {
    events: { label: upperFirst(event.many), path: buildSportEventListPath(sport) },
    participants: { label: upperFirst(participant.many), path: buildSportParticipantListPath(sport) },
  };

  return (
    <PageHeader
      actions={actions}
      tabs={(
        <PageTabs
          aria-label={`${definition.name} lists`}
          items={SPORT_LISTS.map((list) => ({
            isActive: list === current,
            label: lists[list].label,
            testId: `root-admin-sport-menu-${list}`,
            to: lists[list].path,
          }))}
          variant="link"
        />
      )}
      tabsEnd={tabsEnd}
      testId="root-admin-sport-menu"
      title={definition.name}
    />
  );
}
