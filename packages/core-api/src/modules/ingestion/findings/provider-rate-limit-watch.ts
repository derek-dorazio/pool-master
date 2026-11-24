/**
 * The rate-limit finding (league model 1c, #2038): a Provider that has turned every call away for
 * a while raises one PROVIDER_RATE_LIMITED finding on each league it syncs. It is a WARNING once
 * the streak has lasted a quarter of an hour, and an ERROR once it has lasted the league's quiet
 * threshold (`ProviderLeague.quietAfterMinutes`), when its games would already have gone quiet.
 * The Provider's next answer ends the streak and resolves its findings.
 *
 * The provider call policy tells the watch of every call's ending, synchronously; the watch does
 * its database work after, one Provider at a time, so a call never waits on it. The streak is
 * held in memory by each task: a task that restarts begins a new one, and resolves what an
 * earlier task left open at the first answer it hears.
 */
import type { FastifyBaseLogger } from 'fastify';
import {
  ProviderSyncFindingSeverity,
  type ProviderCode,
  type ProviderLeagueSettings,
  type ProviderSettings,
  type SportLeague,
} from '@poolmaster/shared/domain';
import { errorMessage } from '../../../core/error-message';
import type { ProviderRateLimitObserver } from '../core/provider-call-policy';
import type { ProviderSyncFindingService } from './provider-sync-finding-service';

/** How long a Provider rate limits every call before its leagues get a WARNING. */
export const PROVIDER_RATE_LIMITED_WARNING_AFTER_MS = 15 * 60_000;

export interface ProviderRateLimitWatchDeps {
  findings: Pick<ProviderSyncFindingService, 'raiseProviderRateLimited' | 'resolveProviderRateLimited'>;
  /** The Provider rows, in memory (ProviderSettingsStore). */
  providers: {
    byCode(code: ProviderCode): ProviderSettings | undefined;
    enabledLeagues(code: ProviderCode): ProviderLeagueSettings[];
  };
  /** The sport leagues a provider's sync creates events for, with the mapping each syncs from. */
  syncedLeagues: () => Promise<readonly Pick<SportLeague, 'id' | 'selectedProviderMapping'>[]>;
  now?: () => number;
  logger?: FastifyBaseLogger;
}

interface Streak {
  /** When the Provider began turning every call away; null while it answers. */
  since: number | null;
  /** The severity raised so far on each league, by sport league id. */
  raised: Map<string, ProviderSyncFindingSeverity>;
  /** How far into the streak the leagues were last read; a read happens only past a new threshold. */
  checkedMs: number;
  /** Whether a finding may be open: true at start, for what an earlier task left. */
  mayHaveOpen: boolean;
  /** The Provider's database work, one piece after another. */
  work: Promise<void>;
}

export class ProviderRateLimitWatch {
  private readonly streaks = new Map<ProviderCode, Streak>();

  constructor(private readonly deps: ProviderRateLimitWatchDeps) {}

  /** What the provider's call policy tells of each call's ending. */
  observerFor(code: ProviderCode): ProviderRateLimitObserver {
    return {
      refused: () => { this.refused(code); },
      answered: () => { this.answered(code); },
    };
  }

  /** Resolves once the database work already queued is done; for shutdown and tests. */
  async settled(): Promise<void> {
    await Promise.all([...this.streaks.values()].map((streak) => streak.work));
  }

  private streakOf(code: ProviderCode): Streak {
    let streak = this.streaks.get(code);
    if (streak === undefined) {
      streak = { since: null, raised: new Map(), checkedMs: -1, mayHaveOpen: true, work: Promise.resolve() };
      this.streaks.set(code, streak);
    }
    return streak;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private refused(code: ProviderCode): void {
    const streak = this.streakOf(code);
    const now = this.now();
    streak.since ??= now;
    const elapsedMs = now - streak.since;
    const crossed = this.thresholdsMs(code).some((threshold) => threshold > streak.checkedMs && threshold <= elapsedMs);
    if (!crossed) return;
    streak.checkedMs = elapsedMs;
    this.queue(code, streak, async () => {
      try {
        await this.raise(code, streak, elapsedMs);
      } catch (error) {
        // The next refusal tries again.
        streak.checkedMs = -1;
        throw error;
      }
    });
  }

  private answered(code: ProviderCode): void {
    const streak = this.streakOf(code);
    if (streak.since === null && !streak.mayHaveOpen) return;
    streak.since = null;
    streak.raised.clear();
    streak.checkedMs = -1;
    streak.mayHaveOpen = false;
    const provider = this.deps.providers.byCode(code);
    if (provider === undefined) return;
    this.queue(code, streak, async () => {
      const resolved = await this.deps.findings.resolveProviderRateLimited(provider.id);
      if (resolved > 0) {
        this.deps.logger?.info(
          { action: 'ingestion.syncFinding.providerRateLimitEnded', providerId: provider.id, resolved },
          'A provider that was rate limiting answered again',
        );
      }
    });
  }

  /**
   * The streak lengths at which a severity can change: the quarter of an hour and each league's
   * quiet threshold. The leagues are read only when a refusal comes past one not yet read, so a
   * short burst of 429s reads nothing and a long one reads once a threshold.
   */
  private thresholdsMs(code: ProviderCode): number[] {
    return [PROVIDER_RATE_LIMITED_WARNING_AFTER_MS, ...this.deps.providers.enabledLeagues(code).map((league) => league.quietAfterMinutes * 60_000)];
  }

  /** Raises each of the Provider's leagues whose severity the streak has changed. */
  private async raise(code: ProviderCode, streak: Streak, elapsedMs: number): Promise<void> {
    const provider = this.deps.providers.byCode(code);
    if (provider === undefined) return;
    const quietMinutesOf = new Map(this.deps.providers.enabledLeagues(code).map((league) => [league.id, league.quietAfterMinutes] as const));
    const changed: { sportLeagueId: string; severity: ProviderSyncFindingSeverity }[] = [];
    for (const league of await this.deps.syncedLeagues()) {
      const mapping = league.selectedProviderMapping;
      if (mapping?.providerCode !== code) continue;
      const quietMinutes = quietMinutesOf.get(mapping.providerLeagueId);
      if (quietMinutes === undefined) continue;
      const severity = severityAfter(elapsedMs, quietMinutes);
      if (severity === null || streak.raised.get(league.id) === severity) continue;
      changed.push({ sportLeagueId: league.id, severity });
    }
    if (changed.length === 0) return;
    // The streak ended while the leagues were read: its answer has resolved, and nothing is raised.
    if (streak.since === null) return;
    await this.deps.findings.raiseProviderRateLimited({ providerId: provider.id, leagues: changed });
    for (const league of changed) streak.raised.set(league.sportLeagueId, league.severity);
    streak.mayHaveOpen = true;
  }

  private queue(code: ProviderCode, streak: Streak, work: () => Promise<void>): void {
    streak.work = streak.work.then(work).catch((error: unknown) => {
      this.deps.logger?.error(
        { action: 'ingestion.syncFinding.providerRateLimitFailed', providerCode: code, error: errorMessage(error) },
        'Could not record a provider\'s rate limiting as a sync finding',
      );
    });
  }
}

/** ERROR at the league's quiet threshold, WARNING after a quarter of an hour, else nothing yet. */
function severityAfter(elapsedMs: number, quietAfterMinutes: number): ProviderSyncFindingSeverity | null {
  if (elapsedMs >= quietAfterMinutes * 60_000) return ProviderSyncFindingSeverity.ERROR;
  if (elapsedMs >= PROVIDER_RATE_LIMITED_WARNING_AFTER_MS) return ProviderSyncFindingSeverity.WARNING;
  return null;
}
