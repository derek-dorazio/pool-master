import { useState } from 'react';
import { MatchSide } from '@poolmaster/shared/domain';
import { updateEventBracketMatch } from '@/lib/api';
import type { SportEventMatchDto } from '@/lib/api';
import { Button, InlineError, Select } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { bracketErrorMessages, describeEntry, matchNoun } from './bracket-copy';
import { type BracketContext, describeSide, useMatchWrite } from './bracket-match-write';

/** The select's value for a side left without a team. */
const NO_TEAM = '';

/**
 * A draft match's two sides as selects of the field. A side an earlier match fills stays as it
 * is; a team already placed in another match is not offered, so moving one frees its side first.
 */
export function PairingEditor({
  match,
  homeFed,
  awayFed,
  context,
  onDone,
}: {
  match: SportEventMatchDto;
  homeFed: boolean;
  awayFed: boolean;
  context: BracketContext;
  onDone: () => void;
}) {
  const [homeId, setHomeId] = useState(match.homeSportEventParticipantId ?? NO_TEAM);
  const [awayId, setAwayId] = useState(match.awaySportEventParticipantId ?? NO_TEAM);
  const noun = matchNoun(context.vocabulary);
  const team = context.vocabulary.participant;

  const placedElsewhere = new Set(context.bracket
    .filter((other) => other.id !== match.id)
    .flatMap((other) => [other.homeSportEventParticipantId, other.awaySportEventParticipantId])
    .filter((id): id is string => id !== null));
  const options = context.field.filter((entry) => entry.isActive && !placedElsewhere.has(entry.id));

  const save = useMatchWrite({
    context,
    failedAction: 'event.bracket.pairing.failed',
    match,
    onSuccess: onDone,
    refusedMessage: 'Pairing edit was rejected',
    write: (path) => updateEventBracketMatch({
      path,
      body: {
        ...(homeFed ? {} : { homeSportEventParticipantId: homeId === NO_TEAM ? null : homeId }),
        ...(awayFed ? {} : { awaySportEventParticipantId: awayId === NO_TEAM ? null : awayId }),
      },
    }),
  });

  function sideSelect(side: MatchSide, value: string, onChange: (next: string) => void) {
    // A neutral-site pairing reads "home vs away", so its sides are simply first and second.
    const label = match.isNeutralSite
      ? `${side === MatchSide.HOME ? 'First' : 'Second'} ${team.one}`
      : `${side === MatchSide.HOME ? 'Home' : 'Away'} ${team.one}`;
    return (
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {label}
        <Select
          data-testid={`root-admin-bracket-side-${match.matchNumber}-${side}`}
          onChange={(change) => onChange(change.target.value)}
          value={value}
        >
          <option value={NO_TEAM}>{`No ${team.one} yet`}</option>
          {options.map((entry) => (
            <option key={entry.id} value={entry.id}>{describeEntry(entry)}</option>
          ))}
        </Select>
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {homeFed ? <p className="text-sm">{describeSide(match, MatchSide.HOME, context)}</p> : sideSelect(MatchSide.HOME, homeId, setHomeId)}
      {awayFed ? <p className="text-sm">{describeSide(match, MatchSide.AWAY, context)}</p> : sideSelect(MatchSide.AWAY, awayId, setAwayId)}
      <div className="flex gap-2">
        <Button
          data-testid={`root-admin-bracket-save-${match.matchNumber}`}
          disabled={save.isPending || (homeId !== NO_TEAM && homeId === awayId)}
          onClick={() => save.mutate()}
          size="sm"
        >
          Save pairing
        </Button>
        <Button disabled={save.isPending} onClick={onDone} size="sm" variant="ghost">Cancel</Button>
      </div>
      {homeId !== NO_TEAM && homeId === awayId ? (
        <InlineError>{`A ${team.one} can't play itself. Pick two different ${team.many}.`}</InlineError>
      ) : null}
      {save.isError ? (
        <InlineError testId={`root-admin-bracket-pairing-error-${match.matchNumber}`}>
          {extractErrorMessage(save.error, {
            codeMessages: bracketErrorMessages(context.vocabulary, match, context.bracket),
            fallback: `This ${noun.one}'s pairing could not be saved. Try again.`,
          })}
        </InlineError>
      ) : null}
    </div>
  );
}
