import { ProviderSyncKind } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import { Button, QueryState, refetchFailed } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { EventFieldAddParticipantsModal } from './event-field-add-participants-modal';
import { EventFieldGridCard } from './event-field-grid-card';
import { EventFieldRefreshAction } from './event-field-refresh-action';
import { EventFieldSeedAction } from './event-field-seed-action';
import { useEventPage } from './event-page-context';
import { EventSyncsCard } from './event-syncs-card';
import { PriceAssignAction } from './price-assign-action';
import { eventTiersLocked, sportEventHasScoreSync } from './sport-admin-utils';
import { TierAutoAssignActions } from './tier-auto-assign-actions';
import { useSportLeagueNoun } from './use-sport-catalog';
import { useSportEventFieldQuery, useSportEventTiersQuery } from './use-sport-event';

/**
 * The Event page's Field tab (#1890): the event's field sync, then its field grid. Until release
 * the Field section offers automatic tiers and prices; the tools that build a field by hand show
 * only where no sync runs (rules/ux-rules.md §12 item 16).
 */
export function EventFieldTab() {
  const { event, isSynced, overview } = useEventPage();
  const [addOpen, setAddOpen] = useState(false);
  const fieldQuery = useSportEventFieldQuery(event.id);
  const tiersQuery = useSportEventTiersQuery(event.id);
  const sportLeagueNoun = useSportLeagueNoun(event.sport, event.sportLeagueId);
  const entries = useMemo(() => fieldQuery.data ?? [], [fieldQuery.data]);
  const existingParticipantIds = useMemo(() => new Set(entries.map((entry) => entry.participantId)), [entries]);
  const locked = eventTiersLocked(event.status);
  const failedQuery = [fieldQuery, tiersQuery].find((query) => query.isError);
  const loaded = {
    data: fieldQuery.data && tiersQuery.data ? { field: fieldQuery.data, tiers: tiersQuery.data } : undefined,
    isError: failedQuery !== undefined,
    refetch: refetchFailed(fieldQuery, tiersQuery),
  };

  const actions = (
    <span className="flex flex-wrap justify-end gap-2">
      {locked ? null : (
        <>
          <TierAutoAssignActions disabled={entries.length === 0} eventId={event.id} field={entries} />
          <PriceAssignAction
            current={event.pricing}
            disabled={entries.length === 0}
            eventId={event.id}
            field={entries}
            sportLeagueId={event.sportLeagueId}
          />
        </>
      )}
      {isSynced ? null : (
        <>
          <EventFieldSeedAction eventId={event.id} sport={event.sport} sportLeague={sportLeagueNoun} />
          <Button data-testid="root-admin-event-field-add" onClick={() => setAddOpen(true)} size="sm">
            Add more participants
          </Button>
          {sportEventHasScoreSync(event.syncScope) ? (
            // poolmaster-allow-list-lookup: counts the event's field, which this tab shows in full
            <EventFieldRefreshAction eventId={event.id} fieldCount={entries.length} />
          ) : null}
        </>
      )}
    </span>
  );

  return (
    <div className="space-y-6" data-testid="root-admin-event-field-tab">
      <EventSyncsCard event={event} kind={ProviderSyncKind.FIELD} overview={overview} />

      <QueryState
        error={extractErrorMessage(failedQuery?.error, { fallback: 'We could not load the field right now.' })}
        loading="Loading field..."
        query={loaded}
        testId="root-admin-event-field-state"
      >
        {({ field, tiers }) => (
          <EventFieldGridCard actions={actions} event={event} field={field} isSynced={isSynced} overview={overview} tiers={tiers} />
        )}
      </QueryState>

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
