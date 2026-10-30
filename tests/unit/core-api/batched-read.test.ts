import { BatchedRead, batchedByKey } from '../../../packages/core-api/src/core/batched-read';

// What a batched read promises (#1315): asks made side by side are answered from one read, each
// with its own answer, however many promise steps each asker took to get there; a later ask
// starts another read; and a failed read fails every ask it would have answered, never the next.

/** A read of numbers that doubles each, recording the asks it was given. */
function doublingRead() {
  const reads: number[][] = [];
  const read = new BatchedRead<number, number>(async (asks) => {
    reads.push([...asks]);
    return asks.map((ask) => ask * 2);
  });
  return { read, reads };
}

/** `value` after `steps` promise steps, as an asker some awaits deep gets it. */
async function afterSteps<T>(steps: number, value: () => Promise<T>): Promise<T> {
  for (let step = 0; step < steps; step += 1) await Promise.resolve();
  return value();
}

describe('BatchedRead', () => {
  it('answers asks made side by side from one read, each asker with its own answer', async () => {
    const { read, reads } = doublingRead();

    const answers = await Promise.all([1, 2, 3].map((ask) => read.load(ask)));

    expect(answers).toEqual([2, 4, 6]);
    expect(reads).toEqual([[1, 2, 3]]);
  });

  it('batches asks that reach it through different numbers of promise steps in the same turn', async () => {
    const { read, reads } = doublingRead();

    const answers = await Promise.all([0, 3, 10].map((steps, index) => afterSteps(steps, () => read.load(index))));

    expect(answers).toEqual([0, 2, 4]);
    expect(reads).toEqual([[0, 1, 2]]);
  });

  it('starts a second read for an ask made after the first batch went out, and remembers nothing from the first', async () => {
    const { read, reads } = doublingRead();

    await read.load(1);
    await expect(read.load(1)).resolves.toBe(2);

    expect(reads).toEqual([[1], [1]]);
  });

  it('fails every ask of a batch whose read fails, and the next batch reads again', async () => {
    let fail = true;
    const read = new BatchedRead<number, number>(async (asks) => {
      if (fail) throw new Error('the database is down');
      return [...asks];
    });

    const failed = await Promise.allSettled([read.load(1), read.load(2)]);
    fail = false;

    expect(failed.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    await expect(read.load(3)).resolves.toBe(3);
  });

  it('fails every ask of a batch whose read answers fewer asks than it was given', async () => {
    const read = new BatchedRead<number, number>(async (asks) => asks.slice(1));

    await expect(Promise.all([read.load(1), read.load(2)])).rejects.toThrow('A batched read answered 1 of 2 asks.');
  });
});

describe('batchedByKey', () => {
  it("reads every key asked for once and gives each asker the rows under its own key, in the read's order", async () => {
    const rows = [
      { contestId: 'b', name: 'b1' },
      { contestId: 'a', name: 'a1' },
      { contestId: 'b', name: 'b2' },
    ];
    const reads: string[][] = [];
    const read = batchedByKey(async (keys) => {
      reads.push([...keys]);
      return rows.filter((row) => keys.includes(row.contestId));
    }, (row) => row.contestId);

    const [first, second, again, none] = await Promise.all(['b', 'a', 'b', 'c'].map((key) => read.load(key)));

    expect(reads).toEqual([['b', 'a', 'c']]);
    expect(first.map((row) => row.name)).toEqual(['b1', 'b2']);
    expect(second.map((row) => row.name)).toEqual(['a1']);
    expect(again).toEqual(first);
    // Each asker gets an array of its own.
    expect(again).not.toBe(first);
    expect(none).toEqual([]);
  });
});
