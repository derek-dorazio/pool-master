import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { EventPageOfferState } from '@poolmaster/shared/domain';
import { Alert, LinkButton } from '@/features/shared/ui';
import { eventPageCopy, eventPageOfferCopy } from './event-page-copy';
import { buildStartDestination, parseStartRequest } from './start-path';
import { useEventPageQuery } from './use-event-pages-query';

/**
 * The card a league's home shows when an event page's start (#1008) lands there before the
 * contest can be made: when it opens, and that the "Ready for contests" email will say so. Once
 * the offer is open, it offers the setup instead. Nothing without a start in the address.
 */
export function OpensSoonCard({ leagueCode }: { leagueCode: string }) {
  const location = useLocation();
  const request = useMemo(() => parseStartRequest(location.search), [location.search]);
  const pageQuery = useEventPageQuery(request?.sport ?? null, request?.slug);
  const page = pageQuery.data;
  const offer = page && request?.templateId
    ? page.offers.find((candidate) => candidate.template.id === request.templateId)
    : undefined;
  if (!request || !page || !offer) {
    return null;
  }
  const copy = eventPageCopy(page);
  const offerCopy = eventPageOfferCopy(copy, offer);

  return offer.state === EventPageOfferState.OPEN ? (
    <Alert data-testid="league-opens-soon" title={`${copy.name} is open for contests`} tone="info">
      <LinkButton className="mt-3" data-testid="league-opens-soon-set-up" size="sm" to={buildStartDestination(leagueCode, request, offer)}>
        {`Set up your ${offerCopy.contestType}`}
      </LinkButton>
    </Alert>
  ) : (
    <Alert data-testid="league-opens-soon" title={`${copy.name} opens for contests ${offerCopy.opensWhen}`} tone="info">
      <p>{`We'll email you when your ${offerCopy.contestType} can be set up.`}</p>
    </Alert>
  );
}
