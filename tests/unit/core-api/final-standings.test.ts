import { ContestFormat, type Contest } from '@poolmaster/shared/domain';
import type { ContestEntryStandingResult, ContestEntryWithSquad } from '@poolmaster/shared/db';
import { readFinalStandings, type FinalStandingsReadDeps } from '../../../packages/core-api/src/modules/contests/final-standings';
import { buildContest } from '../../factories';

// A settled contest's final places (#845 F1, #863): the order the championship and the final
// results email take, from the frozen standings alone.

const T = new Date('2026-11-01T00:00:00.000Z');

function entry(id: string, entryNumber: number, name: string): ContestEntryWithSquad {
  return { id, contestId: 'pool', squadId: `squad-${id}`, squadName: `Squad ${id}`, entryNumber, name, events: [], createdAt: T, updatedAt: T };
}

function standing(contestEntryId: string, position: number | null): ContestEntryStandingResult {
  return {
    id: `standing-${contestEntryId}`, contestId: 'pool', contestEntryId, position, displayPosition: position === null ? null : String(position),
    countingPickLimit: 1, scoredPickCount: 1, totalScore: position === null ? null : 10 - position, asOf: T, settledAt: T,
  };
}

function deps(standings: ContestEntryStandingResult[], entries: ContestEntryWithSquad[]): FinalStandingsReadDeps {
  return {
    standings: { findByContest: async () => standings },
    entries: { findByContestWithSquad: async () => entries },
    configurations: { findByContest: async () => null },
    scoringRules: { findByContestConfiguration: async () => [] },
  } as unknown as FinalStandingsReadDeps;
}

const squares: Contest = buildContest({ id: 'pool', contestFormat: ContestFormat.SQUARES });

describe('readFinalStandings', () => {
  it('orders places best first, entries sharing a place by entry number then name, and unplaced entries last', async () => {
    const final = await readFinalStandings(deps(
      [standing('unplaced', null), standing('b', 1), standing('a', 1), standing('c', 1), standing('late', null)],
      [entry('unplaced', 1, 'Zed'), entry('late', 1, 'Yan'), entry('a', 1, 'Bravo'), entry('b', 1, 'Alpha'), entry('c', 2, 'Alpha')],
    ), squares);

    expect(final.entries.map((row) => [row.entryId, row.position])).toEqual([['b', 1], ['a', 1], ['c', 1], ['late', null], ['unplaced', null]]);
    expect(final.scoringDefinitionId).toBeNull();
  });

  it('leaves out a standing whose entry has since been removed', async () => {
    const final = await readFinalStandings(deps([standing('gone', 1), standing('a', 2)], [entry('a', 1, 'Alpha')]), squares);

    expect(final.entries.map((row) => row.entryId)).toEqual(['a']);
  });
});
