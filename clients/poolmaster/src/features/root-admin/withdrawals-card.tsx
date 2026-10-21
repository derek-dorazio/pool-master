import { useState } from 'react';
import type { SportVocabulary } from '@poolmaster/shared/domain';
import { replaceEventParticipant } from '@/lib/api';
import type { SportEventDto, SportEventMatchDto, SportEventParticipantDto } from '@/lib/api';
import { Button, Select, Tile } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { bracketErrorMessages, describeEntry, matchNoun, offLeagueRosterMessages, replaceableEntries } from './bracket-copy';
import { useEventLeagueCandidatesQuery, useSportLeagueNoun } from './use-sport-catalog';

const logger = getLogger().child({ feature: 'root-admin-withdrawals' });

/** The select's value before an admin picks a row or a participant. */
const NONE = '';

/**
 * Withdrawals on the bracket tab (#704 slice 3), in any sport: a participant who pulls out before
 * their first match is replaced in their bracket place by one of the active participants on the
 * event's league roster (or the sport's, for a league with no roster) not in the event, such as a
 * tennis lucky loser. The withdrawn participant stays on the field, and every pick of them scores
 * as a loss. Once their match starts, a withdrawal is a walkover,
 * entered as its result. Hidden when nobody can be replaced.
 */
export function WithdrawalsCard({
  event,
  bracket,
  field,
  vocabulary,
}: {
  event: SportEventDto;
  bracket: readonly SportEventMatchDto[];
  field: readonly SportEventParticipantDto[];
  vocabulary: SportVocabulary;
}) {
  const [withdrawnId, setWithdrawnId] = useState(NONE);
  const [replacementId, setReplacementId] = useState(NONE);
  const participant = vocabulary.participant;
  const noun = matchNoun(vocabulary);
  const replaceable = replaceableEntries(bracket, new Map(field.map((entry) => [entry.id, entry])));
  const candidatesQuery = useEventLeagueCandidatesQuery(event);
  const sportLeague = useSportLeagueNoun(event.sport, event.sportLeagueId);
  const inEvent = new Set(field.map((entry) => entry.participantId));
  const candidates = (candidatesQuery.data ?? []).filter((candidate) => !inEvent.has(candidate.id));

  const mutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await replaceEventParticipant({
        path: { eventId: event.id, sportEventParticipantId: withdrawnId },
        body: { participantId: replacementId },
      });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    // The replacement joins the field and the bracket, and the withdrawn row turns inactive.
    invalidates: [
      QueryKeys.rootAdmin.manageSport.field(event.id),
      QueryKeys.rootAdmin.manageSport.bracket(event.id),
    ],
    onError: (error) => {
      logger.warn({ action: 'event.withdrawal.replace.failed', data: { sportEventParticipantId: withdrawnId }, err: error }, 'Replacement was rejected');
    },
  });

  if (replaceable.length === 0) {
    return null;
  }

  return (
    <Tile data-testid="root-admin-withdrawals">
      <h3 className="text-base font-semibold text-foreground">Withdrawals</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {`If a ${participant.one} withdraws before playing, name who takes the place. Picks of the withdrawn ${participant.one} stay, and score as a first-round loss. Once their ${noun.one} starts, enter the withdrawal as a walkover instead.`}
      </p>
      {candidatesQuery.isError ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {extractErrorMessage(candidatesQuery.error, { fallback: `Couldn't load the ${participant.many}. Try again in a moment.` })}
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {`Withdrawn ${participant.one}`}
            <Select data-testid="root-admin-withdrawal-select" onChange={(change) => setWithdrawnId(change.target.value)} value={withdrawnId}>
              <option value={NONE}>{`Choose a ${participant.one}`}</option>
              {replaceable.map((entry) => (
                <option key={entry.id} value={entry.id}>{describeEntry(entry)}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Replaced by
            <Select
              data-testid="root-admin-withdrawal-replacement-select"
              disabled={!candidatesQuery.data}
              onChange={(change) => setReplacementId(change.target.value)}
              value={replacementId}
            >
              <option value={NONE}>{candidatesQuery.data ? `Choose a ${participant.one}` : 'Loading…'}</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </Select>
          </label>
          <Button
            data-testid="root-admin-withdrawal-replace"
            disabled={withdrawnId === NONE || replacementId === NONE || mutation.isPending}
            onClick={() => mutation.mutate(undefined, { onSuccess: () => { setWithdrawnId(NONE); setReplacementId(NONE); } })}
            size="sm"
          >
            {`Replace ${participant.one}`}
          </Button>
          {mutation.isError ? (
            <p className="w-full text-sm text-destructive" role="alert">
              {extractErrorMessage(mutation.error, { codeMessages: { ...bracketErrorMessages(vocabulary), ...offLeagueRosterMessages(vocabulary, sportLeague) }, fallback: `The ${participant.one} could not be replaced. Try again.` })}
            </p>
          ) : null}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">The replacement joins unseeded, last in the last tier, at the lowest price.</p>
    </Tile>
  );
}
