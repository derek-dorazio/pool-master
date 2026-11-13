import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SelectionType, type Sport, type SportNoun } from '@poolmaster/shared/domain';
import type { ContestConfigurationRequest } from '@poolmaster/shared/dto';
import { useRef, useState } from 'react';
import {
  previewGamePicks,
  previewRosterPicks,
  type GamePickPreviewRequest,
  type RosterPickPreviewRequest,
  type SportEventDto,
} from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { Button, ErrorState, HelpTip, LoadingState, Notice, ReadOnlyDetailModal } from '@/features/shared/ui';
import { BracketBoard } from './bracket-board';
import { buildBracketRounds, parseBracketTiebreaker } from './bracket-layout';
import { getCompletionStats, getNextIncompleteGroupId } from './contest-entry-helpers';
import { contestTieLabel } from './contest-sport';
import { PickEmGames } from './pick-em-games';
import {
  nextTrialIds,
  pickPreviewUnavailableReason,
  previewConfidence,
  previewRulesFor,
  previewTeamPick,
  previewTiePick,
  toPreviewWeek,
  trialPickedAtById,
} from './pick-preview';
import { RosterContestEntryLineupSection } from './roster-contest-entry-lineup-section';
import { useSportLeagueRoundLabel } from './use-bracket-round-label';

/** The event a preview draws: its field, tiers, prices and games are the ones members pick from. */
export type PickPreviewEvent = Pick<SportEventDto, 'id' | 'loadedParticipantCount' | 'name' | 'pricing' | 'sport' | 'sportLeagueId'>;

const PREVIEW_ERROR = 'We could not draw the picks page. Please try again.';

/** A trial tap's answer replaces the screen without a loading flash: the last screen stays until it lands. */
const previewQueryDefaults = { placeholderData: keepPreviousData, retry: false, staleTime: Infinity } as const;

/** A preview's answer, or the refusal it met. */
async function previewData<T>(call: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const response = await call;
  if (!response.data) {
    throwApiError(response.error, 'Pick preview response is missing data.');
  }
  return response.data;
}

/** The dialog before a preview's first answer: drawing it, or why it could not be drawn. */
function PreviewPending({ query }: { query: { error: Error | null; isError: boolean; refetch: () => Promise<unknown> } }) {
  return query.isError
    ? <ErrorState body={extractErrorMessage(query.error, { fallback: PREVIEW_ERROR })} onRetry={() => void query.refetch()} testId="pick-preview-error" />
    : <LoadingState body="Drawing the picks page..." testId="pick-preview-loading" />;
}

/**
 * A tiered or budget setup's pick screen: the entry page's lineup, with the commissioner's trial
 * picks on it. Each tap asks the server for the screen again, so tier swaps, the budget and
 * withdrawn golfers read exactly as an entry's do.
 */
function RosterPickPreview({
  leagueId,
  noun,
  rules,
  sport,
  sportEventId,
}: {
  leagueId: string;
  noun: SportNoun;
  rules: RosterPickPreviewRequest['rules'];
  sport: Sport | null;
  sportEventId: string;
}) {
  const [trialIds, setTrialIds] = useState<string[]>([]);
  const [chosenGroupId, setChosenGroupId] = useState<string | null | undefined>(undefined);
  const groupToggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const request: RosterPickPreviewRequest = { sportEventId, rules, sportEventParticipantIds: trialIds };
  const previewQuery = useQuery({
    ...previewQueryDefaults,
    queryKey: QueryKeys.pickPreviews.roster(leagueId, request),
    queryFn: () => previewData(previewRosterPicks({ path: { id: leagueId }, body: request })),
  });
  const preview = previewQuery.data;
  if (!preview) {
    return <PreviewPending query={previewQuery} />;
  }
  const { selectionGroups } = preview;
  const isBudget = preview.selectionType === SelectionType.BUDGET_PICK;
  const stats = getCompletionStats(selectionGroups);
  const expandedGroupId = chosenGroupId !== undefined ? chosenGroupId : getNextIncompleteGroupId(selectionGroups);
  const progressNote = [
    `${stats.totalSelections} of ${stats.requiredSelections} picked`,
    isBudget ? null : `${stats.completedTiers} of ${selectionGroups.length} tiers complete`,
  ].filter((part) => part !== null).join(' · ');
  return (
    <RosterContestEntryLineupSection
      drawState={null}
      expandedGroupId={expandedGroupId}
      groupToggleRefs={groupToggleRefs}
      isBudget={isBudget}
      isBusy={previewQuery.isFetching}
      isEditable
      isMyEntry
      isPreview
      lineupSummary={preview.lineupSummary}
      noun={noun}
      onExpandGroup={setChosenGroupId}
      onPick={({ participantId }) => {
        const group = selectionGroups.find((candidate) => candidate.participants
          .some((participant) => participant.sportEventParticipantId === participantId));
        if (group) {
          // The picks the screen shows, in tap order: the server keeps only rows in the field.
          const standing = new Set(selectionGroups.flatMap((candidate) => candidate.selectedParticipantIds));
          setTrialIds(nextTrialIds(preview, group, participantId, trialIds.filter((id) => standing.has(id))));
        }
        return Promise.resolve();
      }}
      pickError={previewQuery.isError ? extractErrorMessage(previewQuery.error, { fallback: PREVIEW_ERROR }) : null}
      pickedAtById={trialPickedAtById(trialIds)}
      picksHidden={false}
      progressNote={progressNote}
      selectionGroups={selectionGroups}
      sport={sport}
    />
  );
}

/**
 * A pick'em, bracket or survivor setup's pick screen: the entry pages' games or bracket board,
 * with the commissioner's trial picks on it. Each tap asks the server again, so a bracket's later
 * games follow its earlier picks and a confidence value swaps as an entry's does.
 */
function GamePickPreview({
  event,
  leagueId,
  rules,
}: {
  event: PickPreviewEvent;
  leagueId: string;
  rules: GamePickPreviewRequest['rules'];
}) {
  const [picks, setPicks] = useState<GamePickPreviewRequest['picks']>([]);
  const [tiebreakerText, setTiebreakerText] = useState('');
  const [tiebreakerValue, setTiebreakerValue] = useState<number | null>(null);
  const roundLabel = useSportLeagueRoundLabel(event.sport, event.sportLeagueId);
  const request: GamePickPreviewRequest = { sportEventId: event.id, rules, picks };
  const previewQuery = useQuery({
    ...previewQueryDefaults,
    queryKey: QueryKeys.pickPreviews.games(leagueId, request),
    queryFn: () => previewData(previewGamePicks({ path: { id: leagueId }, body: request })),
  });
  const preview = previewQuery.data;
  if (!preview) {
    return <PreviewPending query={previewQuery} />;
  }
  const week = toPreviewWeek(preview, tiebreakerValue);
  const isBusy = previewQuery.isFetching;
  const error = previewQuery.isError
    ? <Notice tone="danger">{extractErrorMessage(previewQuery.error, { fallback: PREVIEW_ERROR })}</Notice>
    : null;
  if (preview.selectionType === SelectionType.BRACKET) {
    return (
      <div className="space-y-4">
        {error}
        <BracketBoard
          canPick
          isBusy={isBusy}
          onPick={(game, team) => setPicks(previewTeamPick(week, game, team))}
          rounds={buildBracketRounds(week.games, roundLabel)}
        />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {error}
      <PickEmGames
        canChange
        gamePicks={week}
        isBusy={isBusy}
        onConfidence={(game, value) => setPicks(previewConfidence(week, game, value))}
        onPick={(game, team) => setPicks(previewTeamPick(week, game, team))}
        tie={{ label: contestTieLabel(event.sport), onPick: (game) => setPicks(previewTiePick(week, game)) }}
        tiebreaker={{
          isSaving: false,
          isTrial: true,
          onChange: (text) => {
            setTiebreakerText(text);
            setTiebreakerValue(parseBracketTiebreaker(text));
          },
          onSave: setTiebreakerValue,
          saveError: null,
          text: tiebreakerText,
        }}
      />
    </div>
  );
}

/**
 * "Preview contest entry" (#1612), beside a setup form's buttons and on a set-up contest's status
 * panel: the page members pick from, drawn from the event's real field and the rules as they
 * stand (the form's, unsaved, or the contest's saved ones), in a large dialog
 * (the whole screen on a phone). The commissioner can tap picks to try it; nothing is saved. A
 * format with no pick screen, or an event with nothing to pick from yet, leaves the button off,
 * with why behind a (?) beside it.
 */
export function PickPreviewAction({
  configuration,
  contestName,
  event,
  leagueId,
  participant,
  rulesError,
  selectionType,
  surface = 'default',
  tierCount,
}: {
  /** The rules as they stand, or null while they don't read. */
  configuration: ContestConfigurationRequest | null;
  contestName: string;
  event: PickPreviewEvent | null;
  leagueId: string;
  participant: SportNoun;
  rulesError: string | null;
  selectionType: SelectionType;
  /** `inverse` on a navy panel, such as a set-up contest's status panel. */
  surface?: 'default' | 'inverse';
  tierCount: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const previewRules = configuration ? previewRulesFor(configuration) : null;
  const reason = pickPreviewUnavailableReason({ event, participant, rulesError, selectionType, tierCount })
    ?? (previewRules === null ? 'Finish the rules to preview the picks page.' : null);
  const shownName = contestName.trim() || 'Untitled contest';
  const title = event === null || shownName.toLowerCase().includes(event.name.trim().toLowerCase())
    ? shownName
    : `${shownName} · ${event.name}`;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        data-testid="pick-preview-open"
        disabled={reason !== null}
        onClick={() => setIsOpen(true)}
        type="button"
        variant={surface === 'inverse' ? 'inverse' : 'secondary'}
      >
        Preview contest entry
      </Button>
      {reason === null ? null : (
        <HelpTip label="Why the preview is off" surface={surface} testId="pick-preview-unavailable">{reason}</HelpTip>
      )}
      {event !== null && previewRules !== null ? (
        <ReadOnlyDetailModal
          detailContent={(
            <div className="space-y-4">
              <Notice data-testid="pick-preview-ribbon">Preview · this is what members pick from. Nothing is saved.</Notice>
              {previewRules.kind === 'roster' ? (
                <RosterPickPreview
                  leagueId={leagueId}
                  noun={participant}
                  rules={previewRules.rules}
                  sport={event.sport}
                  sportEventId={event.id}
                />
              ) : (
                <GamePickPreview event={event} leagueId={leagueId} rules={previewRules.rules} />
              )}
            </div>
          )}
          isFullScreenOnPhone
          onCancel={() => setIsOpen(false)}
          onOpenChange={setIsOpen}
          open={isOpen && reason === null}
          size="xl"
          testId="pick-preview-dialog"
          title={title}
        />
      ) : null}
    </span>
  );
}
