import { useState } from 'react';
import { MatchEnding, MatchSide, MatchStatus, formatSpread, type SportMatchPeriods, type SportShootout, type SportVocabulary } from '@poolmaster/shared/domain';
import { cancelEventMatch, clearEventMatchResult, recordEventMatchResult, updateEventBracketMatch } from '@/lib/api';
import type { SportEventMatchDto, SportEventParticipantDto } from '@/lib/api';
import { tieWord } from '@/features/contests/contest-sport';
import {
  Button,
  ConfirmDialog,
  formatDateTimeDisplay,
  InlineError,
  Input,
  Select,
  StatusBadge,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { bracketErrorMessages, describeEntry, feederOf, formsNoBracket, MATCH_ENDING_MARK, matchNoun, sideEntry } from './bracket-copy';
import { MatchScoresRow } from './match-scores-row';

const logger = getLogger().child({ feature: 'root-admin-bracket' });

const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  [MatchStatus.SCHEDULED]: 'Scheduled',
  [MatchStatus.IN_PROGRESS]: 'In progress',
  [MatchStatus.COMPLETED]: 'Final',
  [MatchStatus.CANCELLED]: 'Cancelled',
};

const MATCH_STATUS_TONE: Record<MatchStatus, 'neutral' | 'active' | 'final' | 'warning'> = {
  [MatchStatus.SCHEDULED]: 'neutral',
  [MatchStatus.IN_PROGRESS]: 'active',
  [MatchStatus.COMPLETED]: 'final',
  [MatchStatus.CANCELLED]: 'warning',
};

/** The ways a match can stop early (#704), as the admin picks one; PLAYED is the winner buttons. */
const EARLY_ENDING_LABEL: Readonly<Record<Exclude<MatchEnding, typeof MatchEnding.PLAYED>, string>> = {
  [MatchEnding.RETIREMENT]: 'Retired',
  [MatchEnding.WALKOVER]: 'Walkover',
  [MatchEnding.DEFAULT]: 'Defaulted',
};

/** The select's value for a side left without a team. */
const NO_TEAM = '';

export type BracketContext = {
  eventId: string;
  vocabulary: SportVocabulary;
  bracket: readonly SportEventMatchDto[];
  field: readonly SportEventParticipantDto[];
  fieldById: ReadonlyMap<string, SportEventParticipantDto>;
  /** Whether the rows carry a spread column: a week of games that forms no bracket (#720). */
  spreads: boolean;
  /** The periods a game is scored by, for a sport that keeps a score at each period's end (#772). */
  periods?: SportMatchPeriods;
  /** How a level bracket match is settled, for a sport that holds shoot-outs (#791); null otherwise. */
  shootout: SportShootout | null;
};

/** A side's team, with its seed, or who fills it while that is still to be decided. */
function describeSide(match: SportEventMatchDto, side: MatchSide, context: BracketContext): string {
  const entry = sideEntry(match, side, context.fieldById);
  if (entry) {
    return describeEntry(entry);
  }
  const feeder = feederOf(match, side, context.bracket);
  return feeder ? `Winner of ${matchNoun(context.vocabulary).one} ${feeder.matchNumber}` : 'To be decided';
}

/** "Duke vs Vermont" on a neutral site, "Bills @ Chiefs" otherwise. */
function describePairing(match: SportEventMatchDto, context: BracketContext): string {
  const home = describeSide(match, MatchSide.HOME, context);
  const away = describeSide(match, MatchSide.AWAY, context);
  return match.isNeutralSite ? `${home} vs ${away}` : `${away} @ ${home}`;
}

/**
 * The bracket and its field change together: a result moves its winner on and rewrites
 * standings. The event's key prefixes its bracket and field keys, so it refreshes all three.
 */
function bracketInvalidates(eventId: string) {
  return [QueryKeys.rootAdmin.manageSport.event(eventId)];
}

/**
 * One match of the bracket tab (#700). Before release an admin edits the pairing of any side no
 * earlier match fills; once the event is released one tap names the winner, and a final result
 * can be switched or cleared while the next match has none. A released game of a week that forms
 * no bracket can be cancelled once it is postponed (#715), or end in a tie (#792). A match that
 * stopped early, in any sport (#704), is entered under "Ended early".
 */
export function BracketMatchRow({ match, released, context }: { match: SportEventMatchDto; released: boolean; context: BracketContext }) {
  const displayPreferences = useDisplayPreferences();
  const [editing, setEditing] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const noun = matchNoun(context.vocabulary);
  const errorCopy = bracketErrorMessages(context.vocabulary, match, context.bracket);

  const result = useInvalidatingMutation({
    mutationFn: async (winnerSide: MatchSide | null) => {
      const path = { eventId: context.eventId, matchNumber: match.matchNumber };
      const response = winnerSide === null
        ? await clearEventMatchResult({ path })
        : await recordEventMatchResult({ path, body: { winnerSide, homeScore: null, awayScore: null } });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    invalidates: bracketInvalidates(context.eventId),
    onError: (error, winnerSide) => {
      logger.warn({ action: 'event.bracket.result.failed', data: { matchNumber: match.matchNumber, winnerSide }, err: error }, 'Match result was rejected');
    },
  });

  const cancel = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await cancelEventMatch({ path: { eventId: context.eventId, matchNumber: match.matchNumber } });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    invalidates: bracketInvalidates(context.eventId),
    onSuccess: () => setConfirmingCancel(false),
    onError: (error) => {
      logger.warn({ action: 'event.bracket.cancel.failed', data: { matchNumber: match.matchNumber }, err: error }, 'Game cancellation was rejected');
    },
  });

  const home = sideEntry(match, MatchSide.HOME, context.fieldById);
  const away = sideEntry(match, MatchSide.AWAY, context.fieldById);
  const decided = match.status === MatchStatus.COMPLETED;
  const homeFed = feederOf(match, MatchSide.HOME, context.bracket) !== undefined;
  const awayFed = feederOf(match, MatchSide.AWAY, context.bracket) !== undefined;
  const pairingEditable = !released && !(homeFed && awayFed);
  const weekGame = formsNoBracket(context.bracket);
  const cancellable = released && match.status === MatchStatus.SCHEDULED && weekGame;
  const closeCancel = () => {
    if (!cancel.isPending) {
      cancel.reset();
      setConfirmingCancel(false);
    }
  };

  // A released game with both teams keeps its score by period, for a sport that has periods.
  const periods = released && home && away && match.status !== MatchStatus.CANCELLED ? context.periods : undefined;

  return (
    <>
      <tr className="border-t border-border align-top" data-testid={`root-admin-bracket-match-${match.matchNumber}`}>
        <td className="px-4 py-2 font-medium">{match.matchNumber}</td>
        <td className="px-4 py-2" data-testid={`root-admin-bracket-pairing-${match.matchNumber}`}>
          {editing ? (
            <PairingEditor context={context} homeFed={homeFed} awayFed={awayFed} match={match} onDone={() => setEditing(false)} />
          ) : describePairing(match, context)}
        </td>
        {context.spreads ? (
          <td className="px-4 py-2" data-testid={`root-admin-bracket-spread-${match.matchNumber}`}>
            <SpreadCell context={context} match={match} released={released} />
          </td>
        ) : null}
        <td className="px-4 py-2 text-muted-foreground">{formatDateTimeDisplay(match.scheduledDate, displayPreferences, 'To be announced')}</td>
        <td className="px-4 py-2">
          <StatusBadge tone={MATCH_STATUS_TONE[match.status]}>{MATCH_STATUS_LABEL[match.status]}</StatusBadge>
        </td>
        <td className="px-4 py-2">
          {pairingEditable && !editing ? (
            <Button data-testid={`root-admin-bracket-edit-${match.matchNumber}`} onClick={() => setEditing(true)} size="sm" variant="secondary">
              Edit pairing
            </Button>
          ) : null}
          {released && home && away && match.status !== MatchStatus.CANCELLED ? (
            <div className="flex flex-wrap gap-2">
              {([[MatchSide.HOME, home], [MatchSide.AWAY, away]] as const).map(([side, entry]) => {
                const won = decided && match.winnerSide === side;
                const mark = MATCH_ENDING_MARK[match.ending];
                return (
                  <Button
                    aria-pressed={won}
                    data-testid={`root-admin-bracket-winner-${match.matchNumber}-${side}`}
                    disabled={won || result.isPending}
                    key={side}
                    onClick={() => result.mutate(side)}
                    size="sm"
                    variant={won ? 'primary' : 'secondary'}
                  >
                    {won ? `${entry.participant.name} won${mark ? ` (${mark})` : ''}` : `${entry.participant.name} wins`}
                  </Button>
                );
              })}
              {weekGame ? <TieResult context={context} match={match} /> : null}
              <EarlyEndingResult away={away} context={context} home={home} match={match} />
              {decided ? (
                <Button
                  data-testid={`root-admin-bracket-clear-${match.matchNumber}`}
                  disabled={result.isPending}
                  onClick={() => result.mutate(null)}
                  size="sm"
                  variant="ghost"
                >
                  Clear result
                </Button>
              ) : null}
              {cancellable ? (
                <Button
                  data-testid={`root-admin-bracket-cancel-${match.matchNumber}`}
                  disabled={result.isPending}
                  onClick={() => setConfirmingCancel(true)}
                  size="sm"
                  variant="ghost"
                >
                  {`Cancel ${noun.one}`}
                </Button>
              ) : null}
            </div>
          ) : null}
          <ConfirmDialog
            cancelLabel={`Keep ${noun.one}`}
            confirmLabel={`Cancel ${noun.one}`}
            confirmTestId={`root-admin-bracket-cancel-confirm-${match.matchNumber}`}
            description={`${describePairing(match, context)} will count for nothing in every contest. If it is played later, add it to the week it moves to before that week is released.`}
            isPending={cancel.isPending}
            onCancel={closeCancel}
            onConfirm={() => cancel.mutate()}
            onOpenChange={(open) => (open ? setConfirmingCancel(true) : closeCancel())}
            open={confirmingCancel}
            pendingLabel="Cancelling..."
            title={`Cancel ${noun.one} ${match.matchNumber}?`}
            tone="danger"
          >
            {cancel.isError ? (
              <InlineError testId={`root-admin-bracket-cancel-error-${match.matchNumber}`}>
                {extractErrorMessage(cancel.error, { codeMessages: errorCopy, fallback: `This ${noun.one} could not be cancelled. Try again.` })}
              </InlineError>
            ) : null}
          </ConfirmDialog>
          {released && (!home || !away) ? (
            <p className="text-sm text-muted-foreground">{`Waiting on both ${context.vocabulary.participant.many}`}</p>
          ) : null}
          {result.isError ? (
            <InlineError className="mt-2" testId={`root-admin-bracket-error-${match.matchNumber}`}>
              {extractErrorMessage(result.error, { codeMessages: errorCopy, fallback: `This ${noun.one}'s result could not be saved. Try again.` })}
            </InlineError>
          ) : null}
        </td>
      </tr>
      {periods ? <MatchScoresRow columns={context.spreads ? 6 : 5} context={context} match={match} periods={periods} /> : null}
    </>
  );
}

/**
 * A game of a week that ended level (#792), called by the sport's word ("Draw" in soccer): a tie
 * needs its score, the same for both sides, so the button asks for it before saving.
 */
function TieResult({ match, context }: { match: SportEventMatchDto; context: BracketContext }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const word = tieWord(context.vocabulary);
  const isTie = match.status === MatchStatus.COMPLETED && match.winnerSide === null;
  const score = /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : null;
  const testId = `root-admin-bracket-tie-${match.matchNumber}`;

  const save = useInvalidatingMutation({
    mutationFn: async (level: number) => {
      const response = await recordEventMatchResult({
        path: { eventId: context.eventId, matchNumber: match.matchNumber },
        body: { winnerSide: null, homeScore: level, awayScore: level },
      });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    invalidates: bracketInvalidates(context.eventId),
    onSuccess: () => setEditing(false),
    onError: (error) => {
      logger.warn({ action: 'event.bracket.tie.failed', data: { matchNumber: match.matchNumber }, err: error }, 'Tie result was rejected');
    },
  });

  if (!editing) {
    return (
      <Button
        aria-pressed={isTie}
        data-testid={testId}
        disabled={isTie}
        onClick={() => {
          save.reset();
          setValue('');
          setEditing(true);
        }}
        size="sm"
        variant={isTie ? 'primary' : 'secondary'}
      >
        {isTie ? `${word} ${match.awayScore ?? ''}-${match.homeScore ?? ''}` : word}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid={`${testId}-editor`}>
      <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
        Each side scored
        <Input
          data-testid={`${testId}-score`}
          inputMode="numeric"
          min="0"
          onChange={(change) => setValue(change.target.value)}
          type="number"
          value={value}
        />
      </label>
      <Button
        data-testid={`${testId}-save`}
        disabled={save.isPending || score === null}
        onClick={() => {
          if (score !== null) save.mutate(score);
        }}
        size="sm"
      >
        {`Save ${word.toLowerCase()}`}
      </Button>
      <Button disabled={save.isPending} onClick={() => setEditing(false)} size="sm" variant="ghost">Cancel</Button>
      {save.isError ? (
        <InlineError className="w-full" testId={`${testId}-error`}>
          {extractErrorMessage(save.error, {
            codeMessages: bracketErrorMessages(context.vocabulary, match, context.bracket),
            fallback: `This ${word.toLowerCase()} could not be saved. Try again.`,
          })}
        </InlineError>
      ) : null}
    </div>
  );
}

/**
 * A match that stopped early (#704): the loser retired, never started (a walkover) or was
 * disqualified. Collapsed under one button so the usual one-tap winner stays as it is; it saves
 * the winner and the ending with no score, which every ending takes.
 */
function EarlyEndingResult({
  match,
  home,
  away,
  context,
}: {
  match: SportEventMatchDto;
  home: SportEventParticipantDto;
  away: SportEventParticipantDto;
  context: BracketContext;
}) {
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState<keyof typeof EARLY_ENDING_LABEL>(MatchEnding.RETIREMENT);
  const [winnerSide, setWinnerSide] = useState<MatchSide>(MatchSide.HOME);
  const testId = `root-admin-bracket-early-${match.matchNumber}`;

  const save = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await recordEventMatchResult({
        path: { eventId: context.eventId, matchNumber: match.matchNumber },
        body: { winnerSide, homeScore: null, awayScore: null, ending },
      });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    invalidates: bracketInvalidates(context.eventId),
    onSuccess: () => setEditing(false),
    onError: (error) => {
      logger.warn({ action: 'event.bracket.early-ending.failed', data: { matchNumber: match.matchNumber, ending }, err: error }, 'Early ending was rejected');
    },
  });

  if (!editing) {
    return (
      <Button
        data-testid={testId}
        onClick={() => {
          save.reset();
          setEnding(match.ending === MatchEnding.PLAYED ? MatchEnding.RETIREMENT : match.ending);
          setWinnerSide(match.winnerSide ?? MatchSide.HOME);
          setEditing(true);
        }}
        size="sm"
        variant="ghost"
      >
        Ended early
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-end gap-2" data-testid={`${testId}-editor`}>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        How it ended
        <Select data-testid={`${testId}-ending`} onChange={(change) => setEnding(change.target.value as keyof typeof EARLY_ENDING_LABEL)} value={ending}>
          {Object.entries(EARLY_ENDING_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Winner
        <Select data-testid={`${testId}-winner`} onChange={(change) => setWinnerSide(change.target.value as MatchSide)} value={winnerSide}>
          <option value={MatchSide.HOME}>{home.participant.name}</option>
          <option value={MatchSide.AWAY}>{away.participant.name}</option>
        </Select>
      </label>
      <Button data-testid={`${testId}-save`} disabled={save.isPending} onClick={() => save.mutate()} size="sm">
        Save result
      </Button>
      <Button disabled={save.isPending} onClick={() => setEditing(false)} size="sm" variant="ghost">Cancel</Button>
      {save.isError ? (
        <InlineError className="w-full" testId={`${testId}-error`}>
          {extractErrorMessage(save.error, {
            codeMessages: bracketErrorMessages(context.vocabulary, match, context.bracket),
            fallback: `This ${matchNoun(context.vocabulary).one}'s result could not be saved. Try again.`,
          })}
        </InlineError>
      ) : null}
    </div>
  );
}

/**
 * A draft match's two sides as selects of the field. A side an earlier match fills stays as it
 * is; a team already placed in another match is not offered, so moving one frees its side first.
 */
function PairingEditor({
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

  const save = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await updateEventBracketMatch({
        path: { eventId: context.eventId, matchNumber: match.matchNumber },
        body: {
          ...(homeFed ? {} : { homeSportEventParticipantId: homeId === NO_TEAM ? null : homeId }),
          ...(awayFed ? {} : { awaySportEventParticipantId: awayId === NO_TEAM ? null : awayId }),
        },
      });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    invalidates: bracketInvalidates(context.eventId),
    onSuccess: onDone,
    onError: (error) => {
      logger.warn({ action: 'event.bracket.pairing.failed', data: { matchNumber: match.matchNumber }, err: error }, 'Pairing edit was rejected');
    },
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

/** "Chiefs -3.5": the spread told from the home team's side, or "No spread" while it has none. */
function describeSpread(match: SportEventMatchDto, context: BracketContext): string {
  if (match.homeSpread === null) {
    return 'No spread';
  }
  const home = sideEntry(match, MatchSide.HOME, context.fieldById);
  const spread = formatSpread(match.homeSpread);
  return home ? `${home.participant.name} ${spread}` : `Home ${spread}`;
}

/**
 * A game's points spread from the home side (#720), used by pools scored against the spread. An
 * admin sets it before release, and after release while no entry has picked the game, which the
 * server checks, though never back to none; a cancelled game keeps its spread.
 */
function SpreadCell({ match, released, context }: { match: SportEventMatchDto; released: boolean; context: BracketContext }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(match.homeSpread === null ? '' : String(match.homeSpread));
  const home = sideEntry(match, MatchSide.HOME, context.fieldById);
  const parsed = value.trim() === '' ? null : Number(value);
  // A released game keeps its spread once set: only a draft one can go back to none.
  const clearing = parsed === null && released;
  const valid = parsed === null ? !clearing : Number.isFinite(parsed) && Math.abs(parsed) <= 99.5 && Number.isInteger(parsed * 2);

  const save = useInvalidatingMutation({
    mutationFn: async (homeSpread: number | null) => {
      const response = await updateEventBracketMatch({
        path: { eventId: context.eventId, matchNumber: match.matchNumber },
        body: { homeSpread },
      });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    invalidates: bracketInvalidates(context.eventId),
    onSuccess: () => setEditing(false),
    onError: (error, homeSpread) => {
      logger.warn({ action: 'event.bracket.spread.failed', data: { matchNumber: match.matchNumber, homeSpread }, err: error }, 'Spread edit was rejected');
    },
  });

  if (!editing) {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className={match.homeSpread === null ? 'text-muted-foreground' : undefined}>{describeSpread(match, context)}</span>
        {match.status !== MatchStatus.CANCELLED ? (
          <Button
            data-testid={`root-admin-bracket-spread-edit-${match.matchNumber}`}
            onClick={() => {
              save.reset();
              setValue(match.homeSpread === null ? '' : String(match.homeSpread));
              setEditing(true);
            }}
            size="sm"
            variant="ghost"
          >
            {match.homeSpread === null ? 'Set spread' : 'Change spread'}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {`${home ? home.participant.name : 'Home'} spread`}
        <Input
          data-testid={`root-admin-bracket-spread-input-${match.matchNumber}`}
          inputMode="decimal"
          onChange={(change) => setValue(change.target.value)}
          placeholder="-3.5"
          step="0.5"
          type="number"
          value={value}
        />
      </label>
      {valid ? null : (
        <InlineError>
          {clearing
            ? `The ${context.vocabulary.event.one} has been released, so this spread can be changed but not cleared.`
            : 'Enter a spread in half points, such as -3.5 or 7, between -99.5 and 99.5.'}
        </InlineError>
      )}
      <div className="flex gap-2">
        <Button
          data-testid={`root-admin-bracket-spread-save-${match.matchNumber}`}
          disabled={save.isPending || !valid}
          onClick={() => save.mutate(parsed)}
          size="sm"
        >
          Save spread
        </Button>
        <Button disabled={save.isPending} onClick={() => setEditing(false)} size="sm" variant="ghost">Cancel</Button>
      </div>
      {save.isError ? (
        <InlineError testId={`root-admin-bracket-spread-error-${match.matchNumber}`}>
          {extractErrorMessage(save.error, {
            codeMessages: bracketErrorMessages(context.vocabulary, match, context.bracket),
            fallback: 'This spread could not be saved. Try again.',
          })}
        </InlineError>
      ) : null}
    </div>
  );
}
