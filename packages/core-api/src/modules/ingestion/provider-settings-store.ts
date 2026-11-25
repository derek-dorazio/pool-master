/**
 * The Provider and ProviderLeague rows a task works from (#1997): read once at startup, then again
 * every minute, so an edit on the Providers page reaches every task without a database call per
 * provider request. The task that saves an edit takes it at once.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderSettingsRepository } from '@poolmaster/shared/db';
import { providerCodeOfSourceId, type ProviderCode, type ProviderLeagueSettings, type ProviderSettings } from '@poolmaster/shared/domain';
import { errorMessage } from '../../core/error-message';

/** How often a task reads the provider rows again. */
export const PROVIDER_SETTINGS_REFRESH_MS = 60_000;

export class ProviderSettingsStore {
  private providers: readonly ProviderSettings[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly repository: Pick<ProviderSettingsRepository, 'findAll'>,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /** Reads every provider and its leagues. */
  async load(): Promise<void> {
    this.providers = await this.repository.findAll();
  }

  /** Reads the rows again every minute until `stop`; a failed read keeps the last rows and is logged. */
  start(refreshMs: number = PROVIDER_SETTINGS_REFRESH_MS): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      this.load().catch((error: unknown) => {
        this.logger?.error({ action: 'ingestion.providerSettings.refreshFailed', error: errorMessage(error) }, 'Could not read the provider settings again; keeping the last ones');
      });
    }, refreshMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Every provider, by code. */
  all(): readonly ProviderSettings[] {
    return this.providers;
  }

  /** The provider with this code; undefined when it has no row. */
  byCode(code: ProviderCode): ProviderSettings | undefined {
    return providerByCode(this.providers, code);
  }

  /**
   * The Provider row of the adapter whose feed carries this source id (`balldontlie`), which every
   * provider mapping, sync run and sync job is keyed to (#2040); undefined for an adapter with no
   * Provider row.
   */
  bySourceId(sourceId: string): ProviderSettings | undefined {
    const code = providerCodeOfSourceId(sourceId);
    return code === undefined ? undefined : this.byCode(code);
  }

  /** A provider's enabled leagues. */
  enabledLeagues(code: ProviderCode): ProviderLeagueSettings[] {
    return this.byCode(code)?.leagues.filter((league) => league.isEnabled) ?? [];
  }

  /** A provider league with its provider; undefined when no provider has it. */
  findLeague(providerLeagueId: string): { provider: ProviderSettings; league: ProviderLeagueSettings } | undefined {
    for (const provider of this.providers) {
      const league = provider.leagues.find((each) => each.id === providerLeagueId);
      if (league !== undefined) return { provider, league };
    }
    return undefined;
  }

  /** Takes a provider as just saved, so the saving task need not wait for the next read. */
  replace(saved: ProviderSettings): void {
    this.providers = this.providers.some((provider) => provider.id === saved.id)
      ? this.providers.map((provider) => (provider.id === saved.id ? saved : provider))
      : [...this.providers, saved].sort((a, b) => a.code.localeCompare(b.code));
  }
}

/** The provider with this code among these; undefined when none has it. */
export function providerByCode(providers: readonly ProviderSettings[], code: ProviderCode): ProviderSettings | undefined {
  return new Map(providers.map((provider) => [provider.code, provider] as const)).get(code);
}
