/**
 * Race helper for the member row lock (#1264): a test holds it in a transaction of its own, as a
 * refresh-token rotation, a reuse revoke or an account delete would, and releases it on cue.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { lockMemberRow } from '../../packages/core-api/src/adapters';

type Work = (tx: Prisma.TransactionClient) => Promise<unknown>;

/**
 * Another writer's transaction on the member's account: it takes the member's row lock, as a
 * rotation, a reuse revoke or an account delete does, runs `work`, and on `release` runs `last`
 * and commits.
 */
export function holdMemberLock(prisma: PrismaClient, userId: string, work: Work = async () => undefined) {
  let signalReady!: (pid: number) => void;
  const ready = new Promise<number>((resolve) => { signalReady = resolve; });
  let releaseWith!: (last: Work) => void;
  const released = new Promise<Work>((resolve) => { releaseWith = resolve; });
  const committed = prisma.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
    await lockMemberRow(tx, userId);
    await work(tx);
    signalReady(pid);
    await (await released)(tx);
  }, { timeout: 20_000 });
  return {
    ready,
    release: async (last: Work = async () => undefined) => {
      releaseWith(last);
      await committed;
    },
  };
}
