import { getSportDefinition, type Sport } from '@poolmaster/shared/domain';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useMemo, useState } from 'react';
import { addEventParticipants } from '@/lib/api';
import {
  Button,
  FormField,
  PickerModal,
  Select,
  ServerErrorBar,
  showToast,
  Text,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AddSportEventParticipantsResponse } from '@/lib/api';
import { useLeagueRosterQuery, useParticipantsQuery, useSportLeaguesQuery } from './use-sport-catalog';
import { fieldWriteKeys } from './use-sport-event';
import { upperFirst } from '@/lib/upper-first';

/** A participant offered for the field: from the browsed roster, or from the name search. */
type AddCandidate = {
  id: string;
  name: string;
  /** The roster ranking, or the nationality of a searched participant. */
  detail: string | null;
};

const SEARCH_MIN_LENGTH = 2;

/**
 * "Add more participants": pick a sport league to list its current roster, or search every
 * participant by name for the rarer one on no roster, tick as many as needed and add them in one
 * `addEventParticipants` call. Participants already in the field are never offered. A save
 * closes the picker and says what was added in a toast.
 */
export function EventFieldAddParticipantsModal({
  eventId,
  existingParticipantIds,
  onClose,
  sport,
}: {
  eventId: string;
  /** The event's sport: its sport leagues and participants are the ones offered. */
  sport: Sport;
  existingParticipantIds: ReadonlySet<string>;
  onClose: () => void;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-sport-event-field-page',
  });
  const [leagueId, setLeagueId] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const { participant, sportLeague } = getSportDefinition(sport).vocabulary;
  const leaguesQuery = useSportLeaguesQuery(sport);
  const rosterQuery = useLeagueRosterQuery(leagueId, { enabled: leagueId !== '' });

  const searchTerm = search.trim();
  const searching = searchTerm.length >= SEARCH_MIN_LENGTH;
  const searchQuery = useParticipantsQuery({
    sport,
    queryKey: QueryKeys.rootAdmin.manageSport.participantSearch(sport, searchTerm),
    status: 'ACTIVE',
    q: searchTerm,
    enabled: searching,
  });

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

  // The roster first, narrowed by the name box; then searched participants on no listed roster.
  const rosterCandidates = useMemo<AddCandidate[]>(() => {
    const needle = searchTerm.toLowerCase();
    return (rosterQuery.data ?? [])
      .filter((entry) => !existingParticipantIds.has(entry.participantId))
      .filter((entry) => needle === '' || entry.participant.name.toLowerCase().includes(needle))
      .map((entry) => ({
        detail: entry.ranking === null ? null : `Ranking ${entry.ranking}`,
        id: entry.participantId,
        name: entry.participant.name,
      }));
  }, [existingParticipantIds, rosterQuery.data, searchTerm]);

  const candidates = useMemo<AddCandidate[]>(() => {
    if (!searching) return rosterCandidates;
    const offered = new Set(rosterCandidates.map((candidate) => candidate.id));
    const searched = (searchQuery.data ?? [])
      .filter((player) => !existingParticipantIds.has(player.id) && !offered.has(player.id))
      .map((player) => ({ detail: player.nationality ?? null, id: player.id, name: player.name }));
    return [...rosterCandidates, ...searched];
  }, [existingParticipantIds, rosterCandidates, searchQuery.data, searching]);

  const allRosterPicked = rosterCandidates.length > 0
    && rosterCandidates.every((candidate) => selected.has(candidate.id));

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
      for (const candidate of rosterCandidates) {
        if (allRosterPicked) next.delete(candidate.id);
        else next.add(candidate.id);
      }
      return next;
    });
  }

  const emptyMessage = leagueId !== '' && rosterQuery.isLoading
    ? 'Loading roster...'
    : searching
      ? searchQuery.isLoading
        ? 'Searching...'
        : `No new ${participant.many} matched that search.`
      : leagueId !== ''
        ? `Every ${participant.one} on that ${sportLeague.one}’s roster is already in this field.`
        : `Pick a ${sportLeague.one} or search by name.`;

  const failure = addMutation.isError
    ? extractErrorMessage(addMutation.error, { fallback: `We could not add the selected ${participant.many}.` })
    : leagueId !== '' && rosterQuery.isError
      ? extractErrorMessage(rosterQuery.error, { fallback: `We could not load that ${sportLeague.one}'s roster.` })
      : searching && searchQuery.isError
        ? extractErrorMessage(searchQuery.error, { fallback: `We could not search ${participant.many} right now.` })
        : null;

  return (
    <PickerModal<AddCandidate>
      applyLabel={`Add selected (${selected.size})`}
      canApply={selected.size > 0}
      emptyMessage={emptyMessage}
      errorMessage={failure}
      filters={(
        <FormField label={upperFirst(sportLeague.one)}>
          {leaguesQuery.isError ? (
            <ServerErrorBar
              error={leaguesQuery.error}
              fallback={`We could not load the ${sportLeague.one} list. Search by name instead.`}
              title={`${upperFirst(sportLeague.many)} unavailable`}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Select
                className="min-w-0 flex-1"
                data-testid="root-admin-event-field-add-league"
                disabled={leaguesQuery.isLoading}
                onChange={(event) => setLeagueId(event.target.value)}
                value={leagueId}
              >
                <option value="">
                  {leaguesQuery.isLoading ? `Loading ${sportLeague.many}...` : `Select a ${sportLeague.one} to browse`}
                </option>
                {(leaguesQuery.data ?? []).map((league) => (
                  <option key={league.id} value={league.id}>
                    {league.name}
                  </option>
                ))}
              </Select>
              {rosterCandidates.length > 0 ? (
                <Button
                  data-testid="root-admin-event-field-add-roster-select-all"
                  onClick={toggleRoster}
                  size="xs"
                  type="button"
                  variant="link"
                >
                  {allRosterPicked ? 'Clear roster' : `Select all ${rosterCandidates.length}`}
                </Button>
              ) : null}
            </div>
          )}
        </FormField>
      )}
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
