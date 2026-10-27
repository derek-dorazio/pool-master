import { useParams } from 'react-router';
import { AsyncPage } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { SportEventHeader } from './sport-event-header';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';
import { getScoringFamilyAdminUi } from './scoring-family-admin';
import { useSportEventQuery } from './use-sport-event';
import { useManagedSport } from './use-managed-sport';

/**
 * An event's results page, `/manage/sports/:sport/events/:eventId/results`: the event's header,
 * then how its scoring family enters results — round scores for stroke play, the finishing order
 * for a race. The family comes from the event's own sport.
 */
export function RootAdminSportEventResultsPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const { definition } = useManagedSport();
  const eventQuery = useSportEventQuery(eventId);
  const event = eventQuery.data;
  const familyUi = event ? getScoringFamilyAdminUi(event) : null;

  useManagePageOwnsHeading();
  useManageBreadcrumbOverride(eventId || undefined, event?.name);
  useManageBreadcrumbOverride('results', familyUi?.resultsLabel);

  return (
    <AsyncPage
      errorBody={extractErrorMessage(eventQuery.error, {
        fallback: `We could not load this ${definition.vocabulary.event.one} right now.`,
      })}
      loadingBody="Loading results..."
      state={eventQuery.isLoading ? 'loading' : eventQuery.isError ? 'error' : 'ready'}
      testId="root-admin-sport-event-results-page"
    >
      {event && familyUi ? (
        <div className="space-y-6">
          <SportEventHeader current="results" tournament={event} />
          <familyUi.ResultsPanel event={event} />
        </div>
      ) : null}
    </AsyncPage>
  );
}
