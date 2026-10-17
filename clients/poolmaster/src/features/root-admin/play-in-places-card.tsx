import { useState } from 'react';
import { SportEventStatus, type SportVocabulary } from '@poolmaster/shared/domain';
import { setEventPlayInWinner, updateEventParticipants } from '@/lib/api';
import type { SportEventDto, SportEventParticipantDto } from '@/lib/api';
import { Button, Select, Tile } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { bracketErrorMessages, describeEntry } from './bracket-copy';
import { useParticipantsQuery } from './use-sport-catalog';

const logger = getLogger().child({ feature: 'root-admin-play-in' });

/** The select's value before an admin picks a row or a team. */
const NONE = '';

/**
 * Play-in places on the bracket tab (#709, #700). Before release an admin marks the field rows
 * that stand for a play-in pairing ("Texas / Xavier"); once released, each marked place takes its
 * winner, chosen from the sport's active teams not already in the event. Only a marked row is
 * offered, and a filled place is a play-in place no more.
 */
export function PlayInPlacesCard({
  event,
  field,
  vocabulary,
}: {
  event: SportEventDto;
  field: readonly SportEventParticipantDto[];
  vocabulary: SportVocabulary;
}) {
  const released = event.status !== SportEventStatus.DRAFT;
  const places = field.filter((entry) => entry.isPlayInPlace);
  const team = vocabulary.participant;

  if (released && places.length === 0) {
    return null;
  }

  return (
    <Tile data-testid="root-admin-play-in-places">
      <h3 className="text-base font-semibold text-foreground">Play-in places</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {released
          ? `Name the ${team.one} that won each play-in. It takes over the place's seed, picks and bracket spot.`
          : `Mark each place that stands for a play-in pairing. Its winner is named after the ${vocabulary.event.one} is released.`}
      </p>
      {places.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="root-admin-play-in-empty">No play-in places.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {places.map((place) => (
            <li className="flex flex-wrap items-center gap-3" data-testid={`root-admin-play-in-place-${place.id}`} key={place.id}>
              <span className="min-w-40 text-sm font-medium">{describeEntry(place)}</span>
              {released
                ? <PlayInWinnerPicker event={event} field={field} place={place} vocabulary={vocabulary} />
                : <PlayInUnmarkButton eventId={event.id} row={place} vocabulary={vocabulary} />}
            </li>
          ))}
        </ul>
      )}
      {released ? null : <PlayInMarker eventId={event.id} field={field} vocabulary={vocabulary} />}
    </Tile>
  );
}

function usePlayInMark(eventId: string) {
  return useInvalidatingMutation({
    mutationFn: async ({ sportEventParticipantId, isPlayInPlace }: { sportEventParticipantId: string; isPlayInPlace: boolean }) => {
      const response = await updateEventParticipants({
        path: { eventId },
        body: { participants: [{ sportEventParticipantId, isPlayInPlace }] },
      });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.field(eventId)],
    onError: (error, variables) => {
      logger.warn({ action: 'event.playIn.mark.failed', data: variables, err: error }, 'Play-in place change was rejected');
    },
  });
}

function PlayInUnmarkButton({ eventId, row, vocabulary }: { eventId: string; row: SportEventParticipantDto; vocabulary: SportVocabulary }) {
  const mutation = usePlayInMark(eventId);
  return (
    <>
      <Button
        data-testid={`root-admin-play-in-unmark-${row.id}`}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ sportEventParticipantId: row.id, isPlayInPlace: false })}
        size="sm"
        variant="ghost"
      >
        Not a play-in place
      </Button>
      {mutation.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {extractErrorMessage(mutation.error, { codeMessages: bracketErrorMessages(vocabulary), fallback: 'That change could not be saved. Try again.' })}
        </p>
      ) : null}
    </>
  );
}

/** Marks one more field row as a play-in place, from the rows not marked yet. */
function PlayInMarker({ eventId, field, vocabulary }: { eventId: string; field: readonly SportEventParticipantDto[]; vocabulary: SportVocabulary }) {
  const [rowId, setRowId] = useState(NONE);
  const mutation = usePlayInMark(eventId);
  const candidates = field.filter((entry) => !entry.isPlayInPlace);

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Mark a play-in place
        <Select data-testid="root-admin-play-in-mark-select" onChange={(change) => setRowId(change.target.value)} value={rowId}>
          <option value={NONE}>{`Choose a ${vocabulary.participant.one}`}</option>
          {candidates.map((entry) => (
            <option key={entry.id} value={entry.id}>{describeEntry(entry)}</option>
          ))}
        </Select>
      </label>
      <Button
        data-testid="root-admin-play-in-mark"
        disabled={rowId === NONE || mutation.isPending}
        onClick={() => mutation.mutate({ sportEventParticipantId: rowId, isPlayInPlace: true }, { onSuccess: () => setRowId(NONE) })}
        size="sm"
        variant="secondary"
      >
        Mark as play-in place
      </Button>
      {mutation.isError ? (
        <p className="w-full text-sm text-destructive" role="alert">
          {extractErrorMessage(mutation.error, { codeMessages: bracketErrorMessages(vocabulary), fallback: 'That change could not be saved. Try again.' })}
        </p>
      ) : null}
    </div>
  );
}

/** Names a released play-in place's winner from the sport's active teams not in the event. */
function PlayInWinnerPicker({
  event,
  field,
  place,
  vocabulary,
}: {
  event: SportEventDto;
  field: readonly SportEventParticipantDto[];
  place: SportEventParticipantDto;
  vocabulary: SportVocabulary;
}) {
  const [participantId, setParticipantId] = useState(NONE);
  const teamsQuery = useParticipantsQuery({
    sport: event.sport,
    status: 'ACTIVE',
    queryKey: QueryKeys.rootAdmin.manageSport.participantList(event.sport, 'ACTIVE'),
  });
  const inEvent = new Set(field.map((entry) => entry.participantId));
  const candidates = (teamsQuery.data ?? []).filter((participant) => !inEvent.has(participant.id));

  const mutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await setEventPlayInWinner({
        path: { eventId: event.id, sportEventParticipantId: place.id },
        body: { participantId },
      });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    // The place now names the winner, and the pairing's own participant is inactivated.
    invalidates: [
      QueryKeys.rootAdmin.manageSport.field(event.id),
      QueryKeys.rootAdmin.manageSport.bracket(event.id),
      QueryKeys.rootAdmin.manageSport.participants,
    ],
    onError: (error) => {
      logger.warn({ action: 'event.playIn.fill.failed', data: { sportEventParticipantId: place.id }, err: error }, 'Play-in winner was rejected');
    },
  });

  if (teamsQuery.isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {extractErrorMessage(teamsQuery.error, { fallback: `Couldn't load the ${vocabulary.participant.many}. Try again in a moment.` })}
      </p>
    );
  }

  return (
    <>
      <Select
        aria-label={`Play-in winner for ${place.participant.name}`}
        data-testid={`root-admin-play-in-winner-select-${place.id}`}
        disabled={!teamsQuery.data}
        onChange={(change) => setParticipantId(change.target.value)}
        value={participantId}
      >
        <option value={NONE}>{teamsQuery.data ? `Choose the winning ${vocabulary.participant.one}` : 'Loading…'}</option>
        {candidates.map((participant) => (
          <option key={participant.id} value={participant.id}>{participant.name}</option>
        ))}
      </Select>
      <Button
        data-testid={`root-admin-play-in-winner-save-${place.id}`}
        disabled={participantId === NONE || mutation.isPending}
        onClick={() => mutation.mutate()}
        size="sm"
      >
        Set winner
      </Button>
      {mutation.isError ? (
        <p className="w-full text-sm text-destructive" role="alert">
          {extractErrorMessage(mutation.error, { codeMessages: bracketErrorMessages(vocabulary), fallback: 'The winner could not be saved. Try again.' })}
        </p>
      ) : null}
    </>
  );
}
