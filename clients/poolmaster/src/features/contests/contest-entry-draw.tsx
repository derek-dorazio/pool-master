import { countParticipants, type SportNoun } from '@poolmaster/shared/domain';
import type { SelectionStateResponse } from '@/lib/api';
import { Alert, formatDateTimeDisplay, MetricGrid, MetricTile, Tile } from '@/features/shared/ui';
import { selectionParticipantLabel } from './contest-sport';
import type { SelectionGroup } from './contest-entry-selection';

/**
 * The entry page for a random-draw contest (a sweepstake). Nobody picks: the commissioner's draw
 * deals every entry its golfers, submits it and closes entries. Before the draw the page says so;
 * after it, it shows what the entry was dealt.
 */

/** The golfers an entry was dealt: the field's selected members, in the field's order. */
function getDealtGolfers(selectionGroups: SelectionGroup[]) {
  return selectionGroups.flatMap((group) => group.participants.filter((participant) => participant.isSelected));
}

/** The summary tiles: the draw, the golfers dealt, and when entries close. */
export function DrawEntryMetrics({
  isEditable,
  noun,
  selectionState,
}: {
  isEditable: boolean;
  /** What the event's sport calls a participant: "golfer", "horse". */
  noun: SportNoun;
  selectionState: SelectionStateResponse;
}) {
  const { drawnAt, rosterSize } = selectionState;
  const dealtCount = getDealtGolfers(selectionState.selectionGroups ?? []).length;
  return (
    <Tile>
      <MetricGrid className="md:grid-cols-3">
        <MetricTile
          helperText={drawnAt ? formatDateTimeDisplay(drawnAt) : 'The commissioner runs it once entries are in'}
          label="Draw"
          value={<span data-testid="contest-entry-draw-status">{drawnAt ? 'Done' : 'Not yet run'}</span>}
        />
        <MetricTile
          helperText={drawnAt ? 'Dealt at random by the draw' : `The draw deals ${countParticipants(rosterSize, noun)} to each entry`}
          label={`${noun.many.charAt(0).toUpperCase()}${noun.many.slice(1)} dealt`}
          value={`${dealtCount}/${rosterSize}`}
        />
        <MetricTile
          helperText={isEditable ? 'Running the draw closes entries' : 'Entry editing is closed'}
          label="Entries close"
          value={isEditable ? 'At the draw' : 'Closed'}
        />
      </MetricGrid>
    </Tile>
  );
}

/**
 * The lineup panel. Before the draw: what will happen and that there is nothing to pick. After
 * it: the dealt golfers, read-only.
 */
export function DrawLineup({ noun, selectionState }: { noun: SportNoun; selectionState: SelectionStateResponse }) {
  const { drawnAt, rosterSize } = selectionState;
  const dealtGolfers = getDealtGolfers(selectionState.selectionGroups ?? []);

  if (!drawnAt) {
    return (
      <Alert data-testid="contest-entry-draw-pending" title="Waiting for the draw">
        There is nothing to pick in this contest. Once entries are in, the commissioner runs the
        draw, which deals this entry {countParticipants(rosterSize, noun)} at random and enters it.
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground" data-testid="contest-entry-draw-done">
        {`Dealt by the commissioner’s draw on ${formatDateTimeDisplay(drawnAt)}. The draw is final.`}
      </p>
      <Tile padding="none" radius="lg">
        <ul aria-label={`Dealt ${noun.many}`} className="divide-y divide-border">
          {dealtGolfers.map((golfer) => (
            <li className="px-4 py-3 text-sm" key={golfer.sportEventParticipantId}>
              <div className="font-medium text-foreground">{selectionParticipantLabel(golfer)}</div>
              {golfer.team ? <div className="mt-1 text-xs text-muted-foreground">{golfer.team}</div> : null}
            </li>
          ))}
        </ul>
      </Tile>
    </div>
  );
}
