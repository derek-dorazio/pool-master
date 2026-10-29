import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Point reads remembered for one request (#1176): the permission gate, the plan gate, the
 * handler and the service each ask for the league or the caller's membership, and within a
 * request the row does not change unless the request itself writes it. Each read is made once
 * per request and the later askers share its promise.
 *
 * A repository opts a read in with `memoizedRead` and forgets the reads a write touches with
 * `forgetReads`. Outside a request scope (scheduler sweeps, scripts, unit tests) both pass
 * straight through, so nothing is remembered there.
 *
 * Remembered values are shared between callers: treat them as read-only.
 */
class ReadMemo {
  private readonly reads = new Map<string, Promise<unknown>>();

  read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const known = this.reads.get(key) as Promise<T> | undefined;
    if (known !== undefined) {
      return known;
    }
    const loading = load();
    this.reads.set(key, loading);
    // A failed read is not remembered: the next asker tries again.
    loading.catch(() => {
      if (this.reads.get(key) === loading) {
        this.reads.delete(key);
      }
    });
    return loading;
  }

  /**
   * The values under `keys`, loading the ones not yet known in one `load` call. A key `load`
   * does not answer is remembered as null, as a point read of a missing row is.
   */
  readMany<T>(keys: readonly string[], load: (missing: readonly string[]) => Promise<Map<string, T>>): Promise<Array<T | null>> {
    const missing = [...new Set(keys.filter((key) => !this.reads.has(key)))];
    if (missing.length > 0) {
      const loading = load(missing);
      for (const key of missing) {
        void this.read(key, async () => (await loading).get(key) ?? null);
      }
    }
    return Promise.all(keys.map((key) => this.reads.get(key) as Promise<T | null>));
  }

  forget(prefix: string): void {
    for (const key of this.reads.keys()) {
      if (key.startsWith(prefix)) {
        this.reads.delete(key);
      }
    }
  }
}

const scope = new AsyncLocalStorage<ReadMemo>();

/** Runs `work` with its own read memo: the request hook, and anything else that wants one. */
export function runWithReadMemo<T>(work: () => T): T {
  return scope.run(new ReadMemo(), work);
}

/**
 * Runs `work` with no read memo, for work a request starts but does not wait for, such as a
 * background sync: it may outlive the request, and must not read what the request remembered.
 */
export function outsideReadMemo<T>(work: () => T): T {
  return scope.exit(work);
}

/**
 * `load`'s result, made once per request under `key`. Pass `client` as the repository's Prisma
 * client: a read through an interactive transaction's client is never remembered, so a
 * transaction always sees its own rows.
 */
export function memoizedRead<T>(
  client: PrismaClient | Prisma.TransactionClient,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const memo = scope.getStore();
  if (memo === undefined || !isRootClient(client)) {
    return load();
  }
  return memo.read(key, load);
}

/**
 * The rows under `ids`, each remembered under `prefix` + id as `memoizedRead` remembers one, so
 * a later point read of any of them is answered here. Only the ids not yet read are loaded, in
 * one `load` call. Rows come back in the order of `ids`, missing ones left out.
 */
export async function memoizedReadMany<T extends { id: string }>(
  client: PrismaClient | Prisma.TransactionClient,
  prefix: ReadMemoPrefix,
  ids: readonly string[],
  load: (ids: readonly string[]) => Promise<T[]>,
): Promise<T[]> {
  const memo = scope.getStore();
  if (memo === undefined || !isRootClient(client)) {
    return load(ids);
  }
  const rows = await memo.readMany<T>(ids.map((id) => `${prefix}${id}`), async (keys) => {
    const loaded = await load(keys.map((key) => key.slice(prefix.length)));
    return new Map(loaded.map((row) => [`${prefix}${row.id}`, row]));
  });
  return [...new Set(rows)].filter((row): row is T => row !== null);
}

/** Drops the remembered reads whose keys start with `prefix`: a write calls it for what it changes. */
export function forgetReads(prefix: ReadMemoPrefix): void {
  scope.getStore()?.forget(prefix);
}

/** Drops every remembered read: a write whose reach spans kinds, such as deleting a league. */
export function forgetAllReads(): void {
  scope.getStore()?.forget('');
}

/** Runs a write, then drops the remembered reads under each prefix, whether or not it succeeded. */
export async function forgettingReads<T>(prefixes: ReadMemoPrefix | readonly ReadMemoPrefix[], write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } finally {
    for (const prefix of typeof prefixes === 'string' ? [prefixes] : prefixes) {
      forgetReads(prefix);
    }
  }
}

/** An interactive transaction's client has no `$transaction` of its own. */
function isRootClient(client: PrismaClient | Prisma.TransactionClient): client is PrismaClient {
  return '$transaction' in client;
}

/** Key prefixes, one per remembered read, so a write names exactly what it forgets. */
export const ReadMemoKey = {
  league: 'league:',
  leagueMembership: 'league-membership:',
  contest: 'contest:',
  contestConfiguration: 'contest-configuration:',
  squadMembership: 'squad-membership:',
  sportEvent: 'sport-event:',
  sportLeague: 'sport-league:',
} as const;

/** One of the `ReadMemoKey` prefixes: what a write names to forget. */
export type ReadMemoPrefix = (typeof ReadMemoKey)[keyof typeof ReadMemoKey];
