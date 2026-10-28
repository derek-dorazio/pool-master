import { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { RequiredEnvMissingError } from './config';

/**
 * Each background job runs on one server task at a time (#1159). Every API task starts the
 * schedulers, and prod runs two; without this, each tick's provider calls, score writes and
 * email fan-out happen once per task.
 */
export interface JobLock {
  /**
   * Runs `work` and resolves true when this task holds the lock named `key`, taking it if no
   * task does. Resolves false without running it while another task holds it.
   */
  runExclusive(key: string, work: () => Promise<void>): Promise<boolean>;
}

/**
 * A Postgres session advisory lock per job, taken with `pg_try_advisory_lock`. The task that
 * takes a job's lock keeps it from tick to tick until it stops, so the job runs on that task
 * alone: a lock released after each tick would only keep two tasks' ticks from overlapping, and
 * each would still run the job on its own timer. When the holder stops or dies, its connection
 * closes, Postgres releases the lock, and another task takes the job at its next tick.
 *
 * The locks live on a connection of their own: a session lock belongs to the connection that
 * took it, and the app's client hands each query whichever pooled connection is free. That
 * connection is never closed for idling. Should it drop and reconnect all the same, its locks
 * are gone, and the backend id each lock was taken on tells this task so at its next tick.
 */
export class PostgresJobLock implements JobLock {
  private client?: PrismaClient;
  /** The backend (session) each held lock was taken on. */
  private readonly heldOn = new Map<string, number>();

  constructor(
    private readonly databaseUrl: string | undefined,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async runExclusive(key: string, work: () => Promise<void>): Promise<boolean> {
    if (!(await this.hold(key))) {
      return false;
    }
    await work();
    return true;
  }

  /** Disconnecting ends the session, which releases every lock this task holds. */
  async close(): Promise<void> {
    this.heldOn.clear();
    await this.client?.$disconnect();
  }

  private async hold(key: string): Promise<boolean> {
    const heldOn = this.heldOn.get(key) ?? 0;
    // A lock already held on this same session is still held, and is not taken again: Postgres
    // counts each repeat take of a session lock, and one release would no longer free it.
    const [row] = await this.connection().$queryRaw<Array<{ backend: number; held: boolean }>>`
      SELECT pg_backend_pid() AS backend,
        CASE WHEN pg_backend_pid() = ${heldOn} THEN true
          ELSE pg_try_advisory_lock(hashtextextended(${key}, 0)) END AS held`;
    const held = row.held;
    if (held && heldOn !== row.backend) {
      this.heldOn.set(key, row.backend);
      this.logger?.info({ key }, 'This task took a background job lock and now runs the job');
    } else if (!held && this.heldOn.delete(key)) {
      this.logger?.warn({ key }, 'This task lost a background job lock and no longer runs the job');
    }
    return held;
  }

  private connection(): PrismaClient {
    if (!this.client) {
      if (!this.databaseUrl) {
        throw new RequiredEnvMissingError(
          'DATABASE_URL',
          'background jobs take their locks in the database',
          'Set it to the app database.',
        );
      }
      this.client = new PrismaClient({ datasourceUrl: jobLockConnectionUrl(this.databaseUrl) });
    }
    return this.client;
  }
}

/** The app's database URL, on a pool of exactly one connection that is never closed for idling. */
export function jobLockConnectionUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('max_idle_connection_lifetime', String(IDLE_LIFETIME_SECONDS));
  return url.toString();
}

/** A year: the connection idles between ticks, holding its locks, for as long as the task runs. */
const IDLE_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
