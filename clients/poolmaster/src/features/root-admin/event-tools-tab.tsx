import { useEventPage } from './event-page-context';
import { EventFieldUploadCard } from './event-field-upload-card';
import { SportEventScoreSourceCard } from './sport-event-score-source-card';
import { useSportEventFieldQuery } from './use-sport-event';

/**
 * The Event page's Tools tab (#1890), shown only on an event no provider syncs: the field's bulk
 * upload, and the link to a provider's live scores for an event an admin keeps.
 */
export function EventToolsTab() {
  const { event } = useEventPage();
  const fieldQuery = useSportEventFieldQuery(event.id);

  return (
    <div className="space-y-6" data-testid="root-admin-event-tools-tab">
      <EventFieldUploadCard entries={fieldQuery.data ?? []} eventId={event.id} sport={event.sport} />
      <SportEventScoreSourceCard eventId={event.id} tournament={event} />
    </div>
  );
}
