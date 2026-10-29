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

/** Drops the remembered reads whose keys start with `prefix`: a write calls it for what it changes. */
export function forgetReads(prefix: string): void {
  scope.getStore()?.forget(prefix);
}

/** Runs a write, then drops the remembered reads under `prefix`, whether or not it succeeded. */
export async function forgettingReads<T>(prefix: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } finally {
    forgetReads(prefix);
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
} as const;
