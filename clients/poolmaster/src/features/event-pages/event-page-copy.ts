import { formatSelectionTypeName, type Sport } from '@poolmaster/shared/domain';
import type { EventPageDto, EventPageOfferDto } from '@/lib/api';
import { SPORT_BLURBS } from '@/features/contest-types/sport-blurbs';
import { STAT_POOL_CONTEST_TYPE } from '@/features/contests/scoring-family-ui/stat-pool-copy';

/** One way to play as its card tells it: the contest type, a line on how it plays, a few facts. */
export interface EventPageOfferCopy {
  contestType: string;
  line: string;
  facts: readonly string[];
  /** When a NOT_YET offer opens, in words: "when the four teams are set". */
  opensWhen: string;
  /** A contest type new this season gets a "New" badge. */
  isNew?: boolean;
}

/** An event page's words (#1007): copy lives in the web app, keyed by the page's stored slug. */
export interface EventPageCopy {
  name: string;
  /** Over the name: what the event is, "NFL conference championships". */
  eyebrow: string;
  /** The hook line under the name, repeated by the page's ads and tiles. */
  hook: string;
  /** When picks close, beside the date: "Picks close at the first kickoff". */
  picksClose: string;
  /** The real league the footer says the page is not affiliated with. */
  leagueName: string;
  /** Each offer's card, by its template's key. */
  offers: Readonly<Record<string, EventPageOfferCopy>>;
}

/**
 * Every event page's copy, by sport then slug. A page with no entry falls back to its sport's
 * How to Play line, and an offer with none to its template's own name and description.
 */
export const EVENT_PAGE_COPY: Readonly<Partial<Record<Sport, Readonly<Record<string, EventPageCopy>>>>> = {
  AMERICAN_FOOTBALL: {
    'championship-weekend': {
      name: 'Championship Weekend',
      eyebrow: 'NFL conference championships',
      hook: 'Four teams, two games, one Sunday. Run a pool for your office, family or group chat, and everyone picks before the first kickoff.',
      picksClose: 'Picks close at the first kickoff',
      leagueName: 'the NFL',
      offers: {
        'championship-weekend-tiered-redzone': {
          contestType: STAT_POOL_CONTEST_TYPE,
          line: 'Pick your stars from the four teams. Each scores Redzone points in their game, and the best card wins.',
          facts: ['Tiered, budget or quick pick', 'Live leaderboard for both games'],
          opensWhen: 'when the four teams are set',
          isNew: true,
        },
        'nfl-bracket-second-chance-doubling': {
          contestType: 'Bracket',
          line: 'Call the last three games: both conference winners and the champion. Later rounds are worth more.',
          facts: ['Three picks, done in a minute', 'Runs through the Super Bowl'],
          opensWhen: 'when the four teams are set',
        },
        'nfl-squares': {
          contestType: 'Squares',
          line: 'Claim boxes on a 10 by 10 grid for one of the two games. The digits are drawn, and each quarter\'s score picks a winner.',
          facts: ['You choose the game', 'No football knowledge needed'],
          opensWhen: 'when the games are scheduled',
        },
      },
    },
  },
};

/** What a page with no copy entry is called: its slug in words, "Championship weekend". */
function nameFromSlug(slug: string): string {
  const words = slug.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function eventPageCopy(page: Pick<EventPageDto, 'sport' | 'slug'>): EventPageCopy {
  return EVENT_PAGE_COPY[page.sport]?.[page.slug] ?? {
    name: nameFromSlug(page.slug),
    eyebrow: '',
    hook: SPORT_BLURBS[page.sport],
    picksClose: 'Picks close when it starts',
    leagueName: 'any sports league',
    offers: {},
  };
}

export function eventPageOfferCopy(copy: EventPageCopy, offer: EventPageOfferDto): EventPageOfferCopy {
  return copy.offers[offer.template.templateKey] ?? {
    contestType: formatSelectionTypeName(offer.template.selectionType),
    line: offer.template.description,
    facts: [],
    opensWhen: 'soon',
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** When an edition starts, from now, as a Coming up card says it: "In 3 weeks", "Tomorrow". */
export function formatStartsIn(startDate: string, now: Date): string {
  const days = Math.ceil((new Date(startDate).getTime() - now.getTime()) / MS_PER_DAY);
  if (days <= 0) return 'Under way';
  if (days === 1) return 'Tomorrow';
  if (days < 14) return `In ${days} days`;
  return `In ${Math.round(days / 7)} weeks`;
}
