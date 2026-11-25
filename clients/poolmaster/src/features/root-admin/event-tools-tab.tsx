import { useEventPage } from './event-page-context';
import { EventFieldUploadCard } from './event-field-upload-card';
import { useSportEventFieldQuery } from './use-sport-event';

/**
 * The Event page's Tools tab (#1890), shown only on an event no provider syncs: the field's bulk
 * upload. A provider's events are linked by sync alone (#2004).
 */
export function EventToolsTab() {
  const { event } = useEventPage();
  const fieldQuery = useSportEventFieldQuery(event.id);

  return (
    <div className="space-y-6" data-testid="root-admin-event-tools-tab">
      <EventFieldUploadCard entries={fieldQuery.data ?? []} eventId={event.id} sport={event.sport} />
    </div>
  );
}
