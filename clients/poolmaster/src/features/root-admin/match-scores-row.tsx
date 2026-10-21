import { useState } from 'react';
import { MatchSide, MatchStatus, type SportMatchPeriods } from '@poolmaster/shared/domain';
import { clearEventMatchPeriodScore, recordEventMatchPeriodScore, recordEventMatchResult } from '@/lib/api';
import type { SportEventMatchDto } from '@/lib/api';
import { Button, Input } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { tieWord } from '@/features/contests/contest-sport';
import { bracketErrorMessages, formsNoBracket, sideEntry } from './bracket-copy';
import type { BracketContext } from './bracket-match-row';

const logger = getLogger().child({ feature: 'root-admin-bracket' });

/** Both sides' score at one scoring moment, or null while it is not entered. */
type MomentScore = { homeScore: number; awayScore: number } | null;

/** Both sides' kicks scored in the shoot-out that settled a level final score (#791). */
type ShootoutScore = { homeShootoutScore: number; awayShootoutScore: number };

/**
 * A released game's scores for a sport that keeps them by period (#772): the score at the end of
 * each period but the last, as the scoreboard shows it, and the final score, overtime included,
 * which is the game's result. Squares pools read them. Each is saved on its own, away side first
 * as a scoreboard reads. In a sport that holds shoot-outs, a bracket match's level final score
 * takes the shoot-out's scores, which name the winner (#791).
 */
export function MatchScoresRow({
  match,
  periods,
  context,
  columns,
}: {
  match: SportEventMatchDto;
  periods: SportMatchPeriods;
  context: BracketContext;
  columns: number;
}) {
  const home = sideEntry(match, MatchSide.HOME, context.fieldById)?.participant.name ?? 'Home';
  const away = sideEntry(match, MatchSide.AWAY, context.fieldById)?.participant.name ?? 'Away';
  const periodNumbers = Array.from({ length: periods.count - 1 }, (_, index) => index + 1);
  const final: MomentScore = match.status === MatchStatus.COMPLETED && match.homeScore !== null && match.awayScore !== null
    ? { homeScore: match.homeScore, awayScore: match.awayScore }
    : null;
  // A result entered with the winner buttons alone has a winner but no final score.
  const winnerOnly = match.status === MatchStatus.COMPLETED && final === null;
  const shootout: ShootoutScore | null = final && match.homeShootoutScore !== null && match.awayShootoutScore !== null
    ? { homeShootoutScore: match.homeShootoutScore, awayShootoutScore: match.awayShootoutScore }
    : null;

  return (
    <tr className="align-top" data-testid={`root-admin-bracket-scores-${match.matchNumber}`}>
      <td className="px-4 pb-3" colSpan={columns}>
        <div className="flex flex-wrap gap-3">
          {periodNumbers.map((periodNumber) => {
            const saved = match.periodScores.find((score) => score.periodNumber === periodNumber);
            return (
              <ScoreMoment
                away={away}
                context={context}
                home={home}
                key={periodNumber}
                label={`End of ${periods.label.one} ${periodNumber}`}
                match={match}
                moment={periodNumber}
                empty="Not entered"
                saved={saved ? { homeScore: saved.homeScore, awayScore: saved.awayScore } : null}
              />
            );
          })}
          <ScoreMoment
            away={away}
            context={context}
            empty={winnerOnly ? 'Winner entered, no score' : 'Not entered'}
            home={home}
            label="Final, overtime included"
            match={match}
            moment="final"
            saved={final}
            savedShootout={shootout}
          />
        </div>
      </td>
    </tr>
  );
}

/** The side a pair of scores names the winner, or null for level scores: a tie (#792). */
function finalWinner(homeScore: number, awayScore: number): MatchSide | null {
  if (homeScore === awayScore) return null;
  return homeScore > awayScore ? MatchSide.HOME : MatchSide.AWAY;
}

/** One scoring moment: a period's end by number, or the final score. */
function ScoreMoment({
  match,
  moment,
  label,
  home,
  away,
  saved,
  savedShootout = null,
  empty,
  context,
}: {
  match: SportEventMatchDto;
  moment: number | 'final';
  label: string;
  home: string;
  away: string;
  saved: MomentScore;
  /** The final score's shoot-out, when a level match went to one. */
  savedShootout?: ShootoutScore | null;
  /** What the moment reads while it has no score. */
  empty: string;
  context: BracketContext;
}) {
  const [editing, setEditing] = useState(false);
  const [awayValue, setAwayValue] = useState('');
  const [homeValue, setHomeValue] = useState('');
  const [awayShootoutValue, setAwayShootoutValue] = useState('');
  const [homeShootoutValue, setHomeShootoutValue] = useState('');
  const testId = `root-admin-bracket-score-${match.matchNumber}-${moment}`;
  const parse = (value: string) => (/^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : null);
  const homeScore = parse(homeValue);
  const awayScore = parse(awayValue);
  // A game of a week, which forms no bracket, can end level (#792); a bracket match always has a winner.
  const tiesAllowed = formsNoBracket(context.bracket);
  const tied = moment === 'final' && !tiesAllowed && homeScore !== null && homeScore === awayScore;
  // A level final score in a sport that holds shoot-outs is settled by one instead of refused.
  const shootout = tied ? context.shootout : null;
  const homeShootoutScore = parse(homeShootoutValue);
  const awayShootoutScore = parse(awayShootoutValue);
  const shootoutLevel = homeShootoutScore !== null && homeShootoutScore === awayShootoutScore;
  const shootoutMissing = shootout !== null && (homeShootoutScore === null || awayShootoutScore === null || shootoutLevel);

  const invalidates = [QueryKeys.rootAdmin.manageSport.event(context.eventId)];
  const path = { eventId: context.eventId, matchNumber: match.matchNumber };
  const onError = (error: Error) => {
    logger.warn({ action: 'event.bracket.score.failed', data: { matchNumber: match.matchNumber, moment }, err: error }, 'Score was rejected');
  };

  const save = useInvalidatingMutation({
    mutationFn: async ({ score, kicks }: { score: { homeScore: number; awayScore: number }; kicks: ShootoutScore | null }) => {
      // A shoot-out names the winner of a level score; otherwise the higher score wins, and a
      // level score of a week game is a tie.
      const winnerSide = kicks ? finalWinner(kicks.homeShootoutScore, kicks.awayShootoutScore) : finalWinner(score.homeScore, score.awayScore);
      const response = moment === 'final'
        ? await recordEventMatchResult({ path, body: { winnerSide, ...score, ...kicks } })
        : await recordEventMatchPeriodScore({ path: { ...path, periodNumber: moment }, body: score });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    invalidates,
    onSuccess: () => setEditing(false),
    onError,
  });

  // Only a period's score is cleared here; the final score goes with the game's result.
  const clear = useInvalidatingMutation({
    mutationFn: async (periodNumber: number) => {
      const response = await clearEventMatchPeriodScore({ path: { ...path, periodNumber } });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    invalidates,
    onError,
  });
  const failed = save.isError ? save.error : clear.isError ? clear.error : null;

  return (
    <div className="min-w-48 rounded-xl border border-border px-3 py-2" data-testid={testId}>
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-2">
            {([[away, awayValue, setAwayValue, 'away'], [home, homeValue, setHomeValue, 'home']] as const).map(([name, value, setValue, side]) => (
              <label className="flex w-24 flex-col gap-1 text-xs text-muted-foreground" key={side}>
                {name}
                <Input
                  data-testid={`${testId}-${side}`}
                  inputMode="numeric"
                  min="0"
                  onChange={(change) => setValue(change.target.value)}
                  type="number"
                  value={value}
                />
              </label>
            ))}
          </div>
          {shootout ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">{`Level after extra time: enter the shoot-out (${shootout.label}).`}</p>
              <div className="flex gap-2">
                {([[away, awayShootoutValue, setAwayShootoutValue, 'away'], [home, homeShootoutValue, setHomeShootoutValue, 'home']] as const).map(([name, value, setValue, side]) => (
                  <label className="flex w-24 flex-col gap-1 text-xs text-muted-foreground" key={side}>
                    {name}
                    <Input
                      data-testid={`${testId}-shootout-${side}`}
                      inputMode="numeric"
                      min="0"
                      onChange={(change) => setValue(change.target.value)}
                      type="number"
                      value={value}
                    />
                  </label>
                ))}
              </div>
              {shootoutLevel ? <p className="text-sm text-destructive">{'The shoot-out can\'t be level: the winner\'s is the higher.'}</p> : null}
            </div>
          ) : tied ? <p className="text-sm text-destructive">{'The final score can\'t be a tie: the winner\'s score is the higher.'}</p> : null}
          <div className="flex gap-2">
            <Button
              data-testid={`${testId}-save`}
              disabled={save.isPending || homeScore === null || awayScore === null || (tied && !shootout) || shootoutMissing}
              onClick={() => {
                if (homeScore === null || awayScore === null) return;
                const kicks = shootout && homeShootoutScore !== null && awayShootoutScore !== null ? { homeShootoutScore, awayShootoutScore } : null;
                save.mutate({ score: { homeScore, awayScore }, kicks });
              }}
              size="sm"
            >
              Save score
            </Button>
            <Button disabled={save.isPending} onClick={() => setEditing(false)} size="sm" variant="ghost">Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className={saved ? 'text-sm' : 'text-sm text-muted-foreground'} data-testid={`${testId}-value`}>
            {saved ? `${away} ${saved.awayScore}, ${home} ${saved.homeScore}${describeLevelFinal(moment, saved, savedShootout, context)}` : empty}
          </span>
          <Button
            data-testid={`${testId}-edit`}
            onClick={() => {
              save.reset();
              clear.reset();
              setAwayValue(saved ? String(saved.awayScore) : '');
              setHomeValue(saved ? String(saved.homeScore) : '');
              setAwayShootoutValue(savedShootout ? String(savedShootout.awayShootoutScore) : '');
              setHomeShootoutValue(savedShootout ? String(savedShootout.homeShootoutScore) : '');
              setEditing(true);
            }}
            size="sm"
            variant="ghost"
          >
            {saved ? 'Change' : 'Enter score'}
          </Button>
          {saved && moment !== 'final' ? (
            <Button data-testid={`${testId}-clear`} disabled={clear.isPending} onClick={() => clear.mutate(moment)} size="sm" variant="ghost">
              Clear
            </Button>
          ) : null}
        </div>
      )}
      {failed ? (
        <p className="mt-2 text-sm text-destructive" data-testid={`${testId}-error`} role="alert">
          {extractErrorMessage(failed, {
            codeMessages: bracketErrorMessages(context.vocabulary, match, context.bracket),
            fallback: 'This score could not be saved. Try again.',
          })}
        </p>
      ) : null}
    </div>
  );
}

/** What follows a level final score: its shoot-out in a bracket, or the sport's word for a tie (#792). */
function describeLevelFinal(
  moment: number | 'final',
  saved: { homeScore: number; awayScore: number },
  shootout: ShootoutScore | null,
  context: BracketContext,
): string {
  if (shootout) return describeShootout(shootout, context);
  return moment === 'final' && saved.awayScore === saved.homeScore ? ` (${tieWord(context.vocabulary).toLowerCase()})` : '';
}

/** A saved shoot-out after the final score, away side first: " (4-3 pens)"; empty for none. */
function describeShootout(shootout: ShootoutScore | null, context: BracketContext): string {
  if (!shootout) return '';
  const label = context.shootout?.label;
  return ` (${shootout.awayShootoutScore}-${shootout.homeShootoutScore}${label ? ` ${label}` : ''})`;
}
