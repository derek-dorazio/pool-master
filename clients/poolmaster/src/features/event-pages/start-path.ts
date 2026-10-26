import { EventPageOfferState, sportPathSegment, type Sport } from '@poolmaster/shared/domain';
import type { EventPageOfferDto } from '@/lib/api';
import { buildLeagueAdminContestCreatePath, buildLeaguePath } from '@/features/leagues/league-routing';
import { sportFromPathSegment } from './event-page-paths';

/**
 * Where an event page's button points (#1008): one page, and the contest setup chosen on it,
 * when one was. The offer's edition and state are read again on arrival, so a link from an old
 * email starts on the edition that can still take a contest.
 */
export interface StartRequest {
  sport: Sport;
  slug: string;
  templateId: string | null;
}

function startQuery({ sport, slug, templateId }: StartRequest): string {
  const query = new URLSearchParams({ sport: sportPathSegment(sport), page: slug });
  if (templateId) {
    query.set('template', templateId);
  }
  return query.toString();
}

/** `/start?sport=american-football&page=championship-weekend&template=<id>`. */
export function buildStartPath(request: StartRequest): string {
  return `/start?${startQuery(request)}`;
}

/** The request a `/start` query names, or null when it names no page. */
export function parseStartRequest(search: string | URLSearchParams): StartRequest | null {
  const query = typeof search === 'string' ? new URLSearchParams(search) : search;
  const sport = sportFromPathSegment(query.get('sport') ?? undefined);
  const slug = query.get('page');
  if (sport === null || !slug) {
    return null;
  }
  return { sport, slug, templateId: query.get('template') };
}

/** The request a return path to `/start` carries, as sign-up holds it; null for any other path. */
export function parseStartReturnPath(path: string): StartRequest | null {
  const [pathname, search = ''] = path.split('?', 2);
  return pathname === '/start' ? parseStartRequest(search) : null;
}

/**
 * Where a commissioner goes in the league they start in: Create contest on the offer's edition
 * when it is open, else the league's home, which says when it opens.
 */
export function buildStartDestination(leagueCode: string, request: StartRequest, offer: EventPageOfferDto | null): string {
  if (offer?.state === EventPageOfferState.OPEN) {
    const query = new URLSearchParams({ template: offer.template.id, event: offer.edition.sportEventId });
    if (offer.startsAtRound !== null) {
      query.set('startRound', String(offer.startsAtRound));
    }
    return `${buildLeagueAdminContestCreatePath(leagueCode)}?${query.toString()}`;
  }
  return offer ? `${buildLeaguePath(leagueCode)}?${startQuery(request)}` : buildLeaguePath(leagueCode);
}
