/**
 * Race helpers for the contest row lock (#644, #646) and the entry row lock (#1259). A test
 * holds the lock in a transaction of its own, as another writer would, starts the writer under test, waits until Postgres reports
 * that writer blocked behind the holder, and only then releases. The interleaving is therefore
 * fixed, not left to timing.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

type Work = (tx: Prisma.TransactionClient) => Promise<unknown>;

export interface ContestLockHolder<T> {
  /** The holder's backend pid, once it holds every lock and `work` has run. */
  ready: Promise<number>;
  /** Runs `last` inside the holder's transaction, commits it, and resolves with what `last` returned. */
  release: (last?: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T | undefined>;
}

/** Holds the given contests' row locks, in id order as the application takes them, then runs `work`. */
export function holdContestLocks<T = unknown>(
  prisma: PrismaClient,
  contestIds: readonly string[],
  work: Work = async () => undefined,
): ContestLockHolder<T> {
  return holdRowLocks<T>(prisma, async (tx) => {
    for (const contestId of [...contestIds].sort()) {
      await tx.$queryRaw`SELECT id FROM "contests" WHERE id = ${contestId}::uuid FOR UPDATE`;
    }
  }, work);
}

/** Holds one contest entry's row lock, as a pick change takes it (#1259), then runs `work`. */
export function holdEntryLock<T = unknown>(
  prisma: PrismaClient,
  entryId: string,
  work: Work = async () => undefined,
): ContestLockHolder<T> {
  return holdRowLocks<T>(prisma, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "contest_entries" WHERE id = ${entryId}::uuid FOR UPDATE`;
  }, work);
}

function holdRowLocks<T>(prisma: PrismaClient, lock: Work, work: Work): ContestLockHolder<T> {
  let signalReady!: (pid: number) => void;
  const ready = new Promise<number>((resolve) => { signalReady = resolve; });
  let releaseWith!: (last: ((tx: Prisma.TransactionClient) => Promise<T>) | undefined) => void;
  const released = new Promise<((tx: Prisma.TransactionClient) => Promise<T>) | undefined>((resolve) => { releaseWith = resolve; });

  const holder = prisma.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
    await lock(tx);
    await work(tx);
    signalReady(pid);
    const last = await released;
    return last ? last(tx) : undefined;
  }, { timeout: 20_000 });

  return {
    ready,
    release: async (last) => {
      releaseWith(last);
      return holder;
    },
  };
}

/** Waits until some other session is blocked behind the holder's transaction; fails if none ever is. */
export async function waitUntilBlockedBy(prisma: PrismaClient, holderPid: number): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const [{ waiting }] = await prisma.$queryRaw<[{ waiting: bigint }]>`
      SELECT count(*)::bigint AS waiting FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))`;
    if (waiting > 0n) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Nothing waited on the lock held by backend ${String(holderPid)}`);
}

/**
 * From inside the holder, whether the contest's entry rows are still free to lock. A writer
 * blocked on the contest row before touching any entry leaves them free; one that already
 * deleted or locked entries does not, and that is the lock order that deadlocks with a draw.
 */
export async function contestEntriesFree(tx: Prisma.TransactionClient, contestId: string): Promise<boolean> {
  await tx.$executeRaw`SAVEPOINT entries_probe`;
  try {
    await tx.$queryRaw`SELECT id FROM "contest_entries" WHERE contest_id = ${contestId}::uuid FOR UPDATE NOWAIT`;
    return true;
  } catch (error) {
    // 55P03 is lock_not_available: NOWAIT met a lock. Anything else is a real failure.
    if (!JSON.stringify(error).includes('55P03')) throw error;
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT entries_probe`;
    return false;
  }
}
