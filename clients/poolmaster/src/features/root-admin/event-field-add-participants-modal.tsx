import { ParticipantStatus, type Sport, sportVocabulary } from '@poolmaster/shared/domain';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useMemo, useState } from 'react';
import { addEventParticipants } from '@/lib/api';
import {
  Button,
  PickerModal,
  showToast,
  Text,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import type { AddSportEventParticipantsResponse } from '@/lib/api';
import { useLeagueRosterQuery } from './use-sport-catalog';
import { fieldWriteKeys } from './use-sport-event';

/** A participant of the event's sport league offered for the field. */
type AddCandidate = {
  id: string;
  name: string;
  /** The participant's ranking in the league. */
  detail: string | null;
};

/**
 * "Add more participants": the active participants of the event's sport league not yet on the
 * field (#1853: a participant belongs to one league, so the field is the league's own), its test
 * participants for a test event (#2096), narrowed
 * by name, ticked and added in one `addEventParticipants` call. A save closes the picker and says
 * what was added in a toast.
 */
export function EventFieldAddParticipantsModal({
  eventId,
  existingParticipantIds,
  onClose,
  sport,
  sportLeagueId,
  testEvent,
}: {
  eventId: string;
  /** The event's sport, for its words. */
  sport: Sport;
  /** The event's sport league, whose participants are offered. */
  sportLeagueId: string;
  existingParticipantIds: ReadonlySet<string>;
  onClose: () => void;
  /** A test event's field takes the league's test participants, which are on no roster (#2096). */
  testEvent: boolean;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-sport-event-field-page',
  });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const { participant, sportLeague } = sportVocabulary(sport);
  const rosterQuery = useLeagueRosterQuery(sportLeagueId, { testData: testEvent });
  const searchTerm = search.trim();

  const addMutation = useInvalidatingMutation({
    mutationFn: async (participantIds: string[]): Promise<AddSportEventParticipantsResponse> => {
      const response = await addEventParticipants({
        path: { eventId },
        body: { participantIds },
      });
      if (!response.data) {
        throwApiError(response.error, 'Bulk add response is missing data.');
      }
      return response.data;
    },
    invalidates: fieldWriteKeys(eventId),
    onSuccess: (result) => {
      showToast({
        description: result.skipped > 0 ? `${result.skipped} were already in it.` : undefined,
        title: `Added ${result.added} ${result.added === 1 ? participant.one : participant.many} to the field`,
        tone: 'success',
      });
      onClose();
    },
    onError: (error) => {
      logger.warn(
        { action: 'event.field.bulkAdd.failed', err: error },
        'Bulk add participants to field was rejected',
      );
    },
  });

  const candidates = useMemo<AddCandidate[]>(() => {
    const needle = searchTerm.toLowerCase();
    // poolmaster-allow-list-lookup: the league's roster, read whole and cached for the roster grid; the read takes no status
    return (rosterQuery.data ?? [])
      .filter((entry) => entry.status === ParticipantStatus.ACTIVE && !existingParticipantIds.has(entry.id))
      .filter((entry) => needle === '' || entry.name.toLowerCase().includes(needle))
      .map((entry) => ({
        detail: entry.ranking === null ? null : `Ranking ${entry.ranking}`,
        id: entry.id,
        name: entry.name,
      }));
  }, [existingParticipantIds, rosterQuery.data, searchTerm]);

  const allRosterPicked = candidates.length > 0
    && candidates.every((candidate) => selected.has(candidate.id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleRoster() {
    setSelected((current) => {
      const next = new Set(current);
      for (const candidate of candidates) {
        if (allRosterPicked) next.delete(candidate.id);
        else next.add(candidate.id);
      }
      return next;
    });
  }

  const emptyMessage = rosterQuery.isLoading
    ? 'Loading roster...'
    : searchTerm !== ''
      ? `No new ${participant.many} matched that search.`
      : `Every active ${participant.one} in this ${sportLeague.one} is already in the field.`;

  const failure = addMutation.isError
    ? extractErrorMessage(addMutation.error, { fallback: `We could not add the selected ${participant.many}.` })
    : rosterQuery.isError
      ? extractErrorMessage(rosterQuery.error, { fallback: `We could not load this ${sportLeague.one}'s roster.` })
      : null;

  return (
    <PickerModal<AddCandidate>
      applyLabel={`Add selected (${selected.size})`}
      canApply={selected.size > 0}
      emptyMessage={emptyMessage}
      errorMessage={failure}
      filters={candidates.length > 0 ? (
        <Button
          data-testid="root-admin-event-field-add-roster-select-all"
          onClick={toggleRoster}
          size="xs"
          type="button"
          variant="link"
        >
          {allRosterPicked ? 'Clear selection' : `Select all ${candidates.length}`}
        </Button>
      ) : null}
      getItemLabel={(candidate) => candidate.name}
      isPending={addMutation.isPending}
      itemTestIdPrefix="root-admin-event-field-add-candidate"
      items={candidates}
      onApply={() => addMutation.mutate([...selected])}
      onCancel={onClose}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onSelect={(candidate) => toggle(candidate.id)}
      open
      renderItem={(candidate) => (
        <>
          <Text size="inherit" variant="strong">{candidate.name}</Text>
          {candidate.detail ? <Text as="span" className="ml-2" variant="meta">{candidate.detail}</Text> : null}
        </>
      )}
      search={{
        label: `Find a ${participant.one}`,
        onChange: setSearch,
        placeholder: 'Name',
        testId: 'root-admin-event-field-add-search',
        value: search,
      }}
      selectedIds={selected}
      testId="root-admin-event-field-add-modal"
      title="Add more participants"
    />
  );
}
