/**
 * Reads asked for together, made as one read (#1315). Code that builds one result per row (a
 * leaderboard per contest, a field per event) asks for its rows one at a time. Run side by side
 * under `Promise.all`, those askers reach each read in the same turn of the event loop, so a
 * `BatchedRead` collects every ask made before the loop's next turn and answers them all from one
 * `readAll` call. Each asker gets the answer to its own ask, as a read of its own would give it.
 *
 * An asker that reaches a read a turn later than the others only starts a second batch: batching
 * changes how many reads are made, never what any asker gets back.
 *
 * Build one per fan-out and let it go with it. It remembers nothing between batches, so a read
 * made after a write sees the write.
 */
export class BatchedRead<Ask, Answer> {
  private pending: Array<{ ask: Ask; resolve: (answer: Answer) => void; reject: (error: unknown) => void }> | null = null;

  /** `readAll` answers every ask it is given, in the order given. */
  constructor(private readonly readAll: (asks: readonly Ask[]) => Promise<readonly Answer[]>) {}

  load(ask: Ask): Promise<Answer> {
    return new Promise<Answer>((resolve, reject) => {
      if (this.pending === null) {
        this.pending = [];
        // After every asker running now, however many promise steps each takes to get here.
        setImmediate(() => void this.dispatch());
      }
      this.pending.push({ ask, resolve, reject });
    });
  }

  private async dispatch(): Promise<void> {
    const batch = this.pending ?? [];
    this.pending = null;
    try {
      const answers = await this.readAll(batch.map(({ ask }) => ask));
      if (answers.length !== batch.length) {
        throw new Error(`A batched read answered ${String(answers.length)} of ${String(batch.length)} asks.`);
      }
      batch.forEach(({ resolve }, index) => resolve(answers[index]));
    } catch (error) {
      for (const { reject } of batch) reject(error);
    }
  }
}

/**
 * A batched read of rows by one key each: `readMany` reads the rows of every key asked for at once,
 * and each asker gets the rows `keyOf` files under its own key, in `readMany`'s order.
 */
export function batchedByKey<Row>(
  readMany: (keys: readonly string[]) => Promise<readonly Row[]>,
  keyOf: (row: Row) => string,
): BatchedRead<string, Row[]> {
  return new BatchedRead(async (keys) => {
    const byKey = new Map<string, Row[]>(keys.map((key) => [key, []]));
    for (const row of await readMany([...new Set(keys)])) byKey.get(keyOf(row))?.push(row);
    return keys.map((key) => [...(byKey.get(key) ?? [])]);
  });
}

/** `target` with `reads` in place of its own methods of those names, and every other method its own. */
export function withReads<Port extends object>(target: Port, reads: Partial<Port>): Port {
  return Object.assign(Object.create(target) as Port, reads);
}

/** A batched read of rows by a list of ids each: one read of every id asked for, each asker given its own ids' rows in its order. */
export function batchedByIds<Row>(readMany: (ids: readonly string[]) => Promise<readonly Row[]>, idOf: (row: Row) => string): BatchedRead<readonly string[], Row[]> {
  return new BatchedRead(async (asks) => {
    const byId = new Map<string, Row>((await readMany([...new Set(asks.flat())])).map((row) => [idOf(row), row]));
    return asks.map((ids) => [...new Set(ids)].map((id) => byId.get(id)).filter((row): row is Row => row !== undefined));
  });
}
