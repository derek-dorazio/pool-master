/**
 * The random-draw selection engine (#601): the office sweepstake. Nobody picks; the
 * commissioner's draw deals every entry `picksPerEntry` members of the field at random, and
 * those dealt picks are scored like any other.
 *
 * So the engine refuses every selection, and the draw itself (`dealRandomDraw`, run by
 * `SelectionService.runDraw`) is what places picks. Before the draw a lineup is short, which
 * is why an entry cannot be submitted by hand; the draw submits every entry it deals to.
 */

import { createHash } from 'node:crypto';
import { SelectionType, type ContestConfiguration } from '@poolmaster/shared/domain';
import {
  completenessIssues,
  SelectionOutcomeKind,
  SelectionRejectCode,
  type SelectionEngine,
} from './selection-engine';

/** How many members of the field the draw deals each entry; 0 without random-draw rules. */
function picksPerEntryOf(configuration: ContestConfiguration | null): number {
  return configuration?.configJson?.selectionType === SelectionType.RANDOM_DRAW
    ? configuration.configJson.picksPerEntry
    : 0;
}

export const randomDrawSelectionEngine: SelectionEngine = {
  selectionType: SelectionType.RANDOM_DRAW,

  rosterSize: ({ configuration }) => picksPerEntryOf(configuration),

  /** Every selection is refused, a held golfer included: dealt picks are final. */
  evaluate: () => ({ kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.DEALT_BY_DRAW }),

  findLineupIssues: ({ rosterSize, picks }) =>
    completenessIssues({ rosterSize, pickCount: picks.length, shortTierNames: [] }),

  /** The whole field as one group, in the field's own order: there is nothing to choose between. */
  groupField: ({ participants, rosterSize }) => [{
    groupId: 'field',
    groupName: 'Field',
    groupNumber: 1,
    picksFromGroup: rosterSize,
    participants: [...participants],
  }],

  summarizeLineup: () => null,

  /** A dealt pick's round is the round of the deal it came in. */
  historyRound: ({ entryPickIndex }) => entryPickIndex,
};

/** One entry's share of a draw: the field rows dealt to it, in the order they were dealt. */
export interface DrawnEntry {
  entryId: string;
  sportEventParticipantIds: string[];
}

/** A draw, worked out: the shuffled orders it dealt from, and what each entry was dealt. */
export interface RandomDrawDeal {
  fieldOrder: string[];
  entryOrder: string[];
  entries: DrawnEntry[];
}

/**
 * Deals a draw (#601). Pure and replayable: the same seed, field, entries and count always
 * deal the same picks, which is what lets a stored draw be shown and checked.
 *
 * The field and the entries are each put in id order (so the input does not depend on how
 * they were read), then shuffled by the seed. The shuffled field is dealt round-robin to the
 * shuffled entries, one card each per round, for `picksPerEntry` rounds, so every entry gets
 * the same count; whatever is left after the last round is not dealt. The caller makes sure
 * the field holds `entryIds.length × picksPerEntry` cards.
 */
export function dealRandomDraw(input: {
  seed: string;
  sportEventParticipantIds: readonly string[];
  entryIds: readonly string[];
  picksPerEntry: number;
}): RandomDrawDeal {
  const { seed, picksPerEntry } = input;
  const fieldOrder = seededShuffle([...input.sportEventParticipantIds].sort(), `${seed}:field`);
  const entryOrder = seededShuffle([...input.entryIds].sort(), `${seed}:entries`);

  const entries = entryOrder.map((entryId, entryIndex) => ({
    entryId,
    sportEventParticipantIds: Array.from(
      { length: picksPerEntry },
      (_, round) => fieldOrder[round * entryOrder.length + entryIndex],
    ),
  }));

  return { fieldOrder, entryOrder, entries };
}

/**
 * A Fisher-Yates shuffle driven by a keyed stream of SHA-256 blocks, so it is the same on
 * every replay and every machine. Each swap index is drawn without modulo bias.
 */
function seededShuffle(items: string[], key: string): string[] {
  const random = seededIntegers(key);
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = random(index + 1);
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

/** A generator of uniform integers in [0, bound), read four bytes at a time from SHA-256(key:n). */
function seededIntegers(key: string): (bound: number) => number {
  const range = 2 ** 32;
  let counter = 0;
  let block = Buffer.alloc(0);
  let offset = 0;

  const nextUint32 = (): number => {
    if (offset + 4 > block.length) {
      block = createHash('sha256').update(`${key}:${counter}`).digest();
      counter += 1;
      offset = 0;
    }
    const value = block.readUInt32BE(offset);
    offset += 4;
    return value;
  };

  return (bound) => {
    // Values at or above the largest multiple of `bound` are redrawn, so every result is equally likely.
    const limit = range - (range % bound);
    let value = nextUint32();
    while (value >= limit) value = nextUint32();
    return value % bound;
  };
}
