import { countParticipants, type SportNoun } from '@poolmaster/shared/domain';
import type { SelectionStateResponse } from '@/lib/api';
import { Notice, formatDateTimeDisplay, Text, Tile, useDisplayPreferences } from '@/features/shared/ui';
import { participantAffiliation, selectionParticipantLabel } from './contest-sport';
import { ParticipantLine } from './participant-line';
import type { SelectionGroup } from './contest-entry-selection';

/** What the draw's panels read from the room: when it ran, how many it deals, and the field. */
export type DrawState = Pick<SelectionStateResponse, 'drawnAt' | 'rosterSize' | 'selectionGroups'>;

/**
 * The entry page for a random-draw contest (a sweepstake). Nobody picks: the commissioner's draw
 * deals every entry its golfers, submits it and closes entries. Before the draw the page says so;
 * after it, it shows what the entry was dealt.
 */

/** The golfers an entry was dealt: the field's selected members, in the field's order. */
function getDealtGolfers(selectionGroups: SelectionGroup[]) {
  return selectionGroups.flatMap((group) => group.participants.filter((participant) => participant.isSelected));
}

/**
 * The lineup panel. Before the draw: what will happen and that there is nothing to pick. After
 * it: the dealt golfers, read-only.
 */
export function DrawLineup({ noun, selectionState }: { noun: SportNoun; selectionState: DrawState }) {
  const displayPreferences = useDisplayPreferences();
  const { drawnAt, rosterSize } = selectionState;
  const dealtGolfers = getDealtGolfers(selectionState.selectionGroups ?? []);

  if (!drawnAt) {
    return (
      <Notice data-testid="contest-entry-draw-pending" title="Waiting for the draw">
        There is nothing to pick in this contest. Once entries are in, the commissioner runs the
        draw, which deals this entry {countParticipants(rosterSize, noun)} at random and enters it.
      </Notice>
    );
  }

  return (
    <div className="space-y-3">
      <Text as="p" data-testid="contest-entry-draw-done" variant="meta">
        {`Dealt by the commissioner’s draw on ${formatDateTimeDisplay(drawnAt, displayPreferences)}. The draw is final.`}
      </Text>
      <Tile padding="none">
        <ul aria-label={`Dealt ${noun.many}`} className="divide-y divide-border">
          {dealtGolfers.map((golfer) => (
            <li className="px-4 py-3" key={golfer.sportEventParticipantId}>
              <ParticipantLine
                affiliation={participantAffiliation(golfer)}
                density="compact"
                name={selectionParticipantLabel(golfer)}
              />
            </li>
          ))}
        </ul>
      </Tile>
    </div>
  );
}
