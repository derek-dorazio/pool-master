import { ProviderSyncKind } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import { Button, ErrorState } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { EventFieldAddParticipantsModal } from './event-field-add-participants-modal';
import { EventFieldGridCard } from './event-field-grid-card';
import { EventFieldRefreshAction } from './event-field-refresh-action';
import { EventFieldSeedAction } from './event-field-seed-action';
import { useEventPage } from './event-page-context';
import { EventSyncsCard } from './event-syncs-card';
import { eventTiersLocked, sportEventHasScoreSync } from './sport-admin-utils';
import { useSportLeagueNoun } from './use-sport-catalog';
import { useSportEventFieldQuery } from './use-sport-event';

/**
 * The Event page's Field tab (#1890): the event's field sync, then its field grid with the
 * actions that build the field by hand. A manual event linked to a provider's scores loads its
 * field from there; a synced event's Sync now does that for it.
 */
export function EventFieldTab() {
  const { event, isSynced, overview } = useEventPage();
  const [addOpen, setAddOpen] = useState(false);
  const fieldQuery = useSportEventFieldQuery(event.id);
  const sportLeagueNoun = useSportLeagueNoun(event.sport, event.sportLeagueId);
  const entries = useMemo(() => fieldQuery.data ?? [], [fieldQuery.data]);
  const existingParticipantIds = useMemo(() => new Set(entries.map((entry) => entry.participantId)), [entries]);

  return (
    <div className="space-y-6" data-testid="root-admin-event-field-tab">
      <EventSyncsCard event={event} kind={ProviderSyncKind.FIELD} overview={overview} />

      <div className="flex flex-wrap justify-end gap-2">
        <EventFieldSeedAction eventId={event.id} sport={event.sport} sportLeague={sportLeagueNoun} />
        <Button data-testid="root-admin-event-field-add" onClick={() => setAddOpen(true)} size="sm">
          Add more participants
        </Button>
        {!isSynced && sportEventHasScoreSync(event.syncScope) ? (
          // poolmaster-allow-list-lookup: counts the event's field, which this tab shows in full
          <EventFieldRefreshAction eventId={event.id} fieldCount={entries.length} />
        ) : null}
      </div>

      {fieldQuery.isError ? (
        <ErrorState
          body={extractErrorMessage(fieldQuery.error, { fallback: 'We could not load the field right now.' })}
          onRetry={() => void fieldQuery.refetch()}
          testId="root-admin-event-field-load-error"
        />
      ) : null}

      <EventFieldGridCard
        entries={entries}
        eventId={event.id}
        fieldLoading={fieldQuery.isLoading}
        pricesLocked={eventTiersLocked(event.status)}
        sport={event.sport}
        sportLeagueNoun={sportLeagueNoun}
      />

      {addOpen ? (
        <EventFieldAddParticipantsModal
          eventId={event.id}
          existingParticipantIds={existingParticipantIds}
          onClose={() => setAddOpen(false)}
          sport={event.sport}
          sportLeagueId={event.sportLeagueId}
        />
      ) : null}
    </div>
  );
}
