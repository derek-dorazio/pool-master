import { useParams } from 'react-router';
import { QueryState } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { SportEventHeader } from './sport-event-header';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
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

  useManageBreadcrumbOverride(eventId || undefined, event?.name);
  useManageBreadcrumbOverride('results', familyUi?.resultsLabel);

  return (
    <section data-testid="root-admin-sport-event-results-page">
      <QueryState
        error={extractErrorMessage(eventQuery.error, {
          fallback: `We could not load this ${definition.vocabulary.event.one} right now.`,
        })}
        loading="Loading results..."
        query={eventQuery}
        size="tile"
        testId="root-admin-sport-event-results"
      >
        {(loaded) => (familyUi ? (
          <div className="space-y-6">
            <SportEventHeader current="results" tournament={loaded} />
            <familyUi.ResultsPanel event={loaded} />
          </div>
        ) : null)}
      </QueryState>
    </section>
  );
}
