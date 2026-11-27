import { slotLabel } from '@poolmaster/shared/display-strings';
import { ProviderSyncKind } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import { Button, FormField, QueryState, refetchFailed, Select } from '@/features/shared/ui';
import type { SportEventDto } from '@/lib/api';
import { extractErrorMessage } from '@/lib/errors';
import { EventFieldAddParticipantsModal } from './event-field-add-participants-modal';
import { EventFieldGridCard } from './event-field-grid-card';
import { useEventPage } from './event-page-context';
import { EventSyncsCard } from './event-syncs-card';
import { PriceAssignAction } from './price-assign-action';
import { TierAutoAssignActions } from './tier-auto-assign-actions';
import { useSportEventFieldQuery, useSportEventSlotFieldQuery, useSportEventSlotTiersQuery } from './use-sport-event';

type TierSet = SportEventDto['tierSets'][number];

/**
 * The Event page's Field tab (#1890): the event's field sync, then its field grid. Each slot a
 * tiered or budget contest can start at holds a tier set of its own (#2044); with more than one,
 * a slot selector picks the set the grid shows, from the tier-set slot first. Until a set is
 * locked the Field section offers automatic tiers and prices for it; the tools that build a field
 * by hand show only where no sync runs (rules/ux-rules.md §12 item 16).
 */
export function EventFieldTab() {
  const { event, isSynced, overview } = useEventPage();
  const [addOpen, setAddOpen] = useState(false);
  const [chosenSlotId, setChosenSlotId] = useState<string | null>(null);
  const tierSet: TierSet | undefined = event.tierSets.find((set) => set.seasonSlotId === chosenSlotId) ?? event.tierSets.at(0);
  const seasonSlotId = tierSet?.seasonSlotId ?? '';
  // An event the sync has not placed in a slot yet has a field but no set: its field is read alone.
  const slotFieldQuery = useSportEventSlotFieldQuery(event.id, seasonSlotId);
  const eventFieldQuery = useSportEventFieldQuery(tierSet === undefined ? event.id : '');
  const fieldQuery = tierSet === undefined ? eventFieldQuery : slotFieldQuery;
  const tiersQuery = useSportEventSlotTiersQuery(event.id, seasonSlotId);
  const entries = useMemo(() => fieldQuery.data ?? [], [fieldQuery.data]);
  const existingParticipantIds = useMemo(() => new Set(entries.map((entry) => entry.participantId)), [entries]);
  const open = tierSet !== undefined && !tierSet.tiersLocked;
  const tiers = tierSet === undefined ? [] : tiersQuery.data;
  const failedQuery = [fieldQuery, ...(tierSet === undefined ? [] : [tiersQuery])].find((query) => query.isError);
  const loaded = {
    data: fieldQuery.data && tiers ? { field: fieldQuery.data, tiers } : undefined,
    isError: failedQuery !== undefined,
    refetch: refetchFailed(fieldQuery, tiersQuery),
  };

  const actions = (
    <span className="flex flex-wrap justify-end gap-2">
      {open ? (
        <>
          <TierAutoAssignActions disabled={entries.length === 0} eventId={event.id} field={entries} overview={overview} seasonSlotId={seasonSlotId} />
          <PriceAssignAction
            current={tierSet.pricing}
            disabled={entries.length === 0}
            eventId={event.id}
            field={entries}
            overview={overview}
            seasonSlotId={seasonSlotId}
            sportLeagueId={event.sportLeagueId}
          />
        </>
      ) : null}
      {isSynced ? null : (
        <Button data-testid="root-admin-event-field-add" onClick={() => setAddOpen(true)} size="sm">
          Add more participants
        </Button>
      )}
    </span>
  );

  return (
    <div className="space-y-6" data-testid="root-admin-event-field-tab">
      <EventSyncsCard event={event} kind={ProviderSyncKind.FIELD} overview={overview} />

      {event.tierSets.length > 1 ? (
        <FormField help="Each slot a tiered or budget contest can start at has its own tiers and prices." label="Tiers and prices for">
          <Select data-testid="root-admin-event-field-slot" onChange={(change) => setChosenSlotId(change.target.value)} value={seasonSlotId}>
            {event.tierSets.map((set) => (
              <option key={set.seasonSlotId} value={set.seasonSlotId}>{slotLabelOf(event, set)}</option>
            ))}
          </Select>
        </FormField>
      ) : null}

      <QueryState
        error={extractErrorMessage(failedQuery?.error, { fallback: 'We could not load the field right now.' })}
        loading="Loading field..."
        query={loaded}
        testId="root-admin-event-field-state"
      >
        {(read) => (
          <EventFieldGridCard
            actions={actions}
            event={event}
            field={read.field}
            isSynced={isSynced}
            overview={overview}
            tierAndPriceEditable={open && tierSet.isTierSetSlot}
            tiers={read.tiers}
          />
        )}
      </QueryState>

      {addOpen ? (
        <EventFieldAddParticipantsModal
          eventId={event.id}
          existingParticipantIds={existingParticipantIds}
          onClose={() => setAddOpen(false)}
          sport={event.sport}
          sportLeagueId={event.sportLeagueId}
          testEvent={event.isTestData}
        />
      ) : null}
    </div>
  );
}

/** A set's slot as the selector names it: the event's slot it is. */
function slotLabelOf(event: SportEventDto, set: TierSet): string {
  const slot = event.slots.find((each) => each.id === set.seasonSlotId);
  return slot === undefined ? '' : slotLabel(slot);
}
