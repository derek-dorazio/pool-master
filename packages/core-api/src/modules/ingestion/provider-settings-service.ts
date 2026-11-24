/**
 * The Providers page's edits (#1997): a provider's settings and its leagues'. A save is taken by
 * this task at once and by every other task on its next read of the rows, within a minute.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderSettingsRepository } from '@poolmaster/shared/db';
import type {
  ProviderLeagueSettings,
  ProviderLeagueSettingsUpdate,
  ProviderSettings,
  ProviderSettingsUpdate,
} from '@poolmaster/shared/domain';
import type { ProviderSettingsStore } from './provider-settings-store';
import type { ProviderWebhookSwitch } from './provider-webhook-switch';

export type ProviderSettingsErrorCode =
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_LEAGUE_NOT_FOUND'
  | 'PROVIDER_PRIORITY_TAKEN'
  | 'PROVIDER_WEBHOOK_SECRET_MISSING';

const STATUS_BY_CODE: Record<ProviderSettingsErrorCode, number> = {
  PROVIDER_NOT_FOUND: 404,
  PROVIDER_LEAGUE_NOT_FOUND: 404,
  PROVIDER_PRIORITY_TAKEN: 409,
  PROVIDER_WEBHOOK_SECRET_MISSING: 422,
};

export class ProviderSettingsError extends Error {
  readonly statusCode: number;

  constructor(message: string, readonly code: ProviderSettingsErrorCode) {
    super(message);
    this.name = 'ProviderSettingsError';
    this.statusCode = STATUS_BY_CODE[code];
  }
}

export interface ProviderSettingsServiceDeps {
  repository: Pick<ProviderSettingsRepository, 'findById' | 'update' | 'updateLeague'>;
  store: Pick<ProviderSettingsStore, 'replace'>;
  webhooks: Pick<ProviderWebhookSwitch, 'isSecretSet'>;
  logger?: FastifyBaseLogger;
}

export class ProviderSettingsService {
  constructor(private readonly deps: ProviderSettingsServiceDeps) {}

  /**
   * Saves a provider's settings, with whether its secret is set. 404 PROVIDER_NOT_FOUND; 409
   * PROVIDER_PRIORITY_TAKEN; 422 PROVIDER_WEBHOOK_SECRET_MISSING when its webhooks would be
   * switched on while its signing secret is not set here.
   */
  async updateProvider(providerId: string, updates: ProviderSettingsUpdate): Promise<{ provider: ProviderSettings; webhookSecretSet: boolean }> {
    if (updates.webhooksEnabled === true) {
      const current = await this.deps.repository.findById(providerId);
      if (current === null) throw notFound(providerId);
      if (!this.deps.webhooks.isSecretSet(current.code)) {
        this.deps.logger?.warn(
          { action: 'ingestion.providerSettings.webhookSecretMissing', providerId, providerCode: current.code },
          'Refused to switch a provider\'s webhooks on while its signing secret is not set',
        );
        throw new ProviderSettingsError(
          `${current.name}'s webhook signing secret is not set in this environment, so its webhooks cannot be switched on.`,
          'PROVIDER_WEBHOOK_SECRET_MISSING',
        );
      }
    }
    const saved = await this.deps.repository.update(providerId, updates);
    if (saved === 'NOT_FOUND') throw notFound(providerId);
    if (saved === 'PRIORITY_TAKEN') {
      throw new ProviderSettingsError(`Another provider already has priority ${String(updates.priority)}.`, 'PROVIDER_PRIORITY_TAKEN');
    }
    this.deps.store.replace(saved);
    this.deps.logger?.info(
      { action: 'ingestion.providerSettings.updated', providerId, providerCode: saved.code, fields: Object.keys(updates) },
      'Updated a provider\'s settings',
    );
    return { provider: saved, webhookSecretSet: this.deps.webhooks.isSecretSet(saved.code) };
  }

  /** Saves one of a provider's leagues. 404 PROVIDER_LEAGUE_NOT_FOUND when the provider has no such league. */
  async updateLeague(providerId: string, leagueId: string, updates: ProviderLeagueSettingsUpdate): Promise<ProviderLeagueSettings> {
    const saved = await this.deps.repository.updateLeague(providerId, leagueId, updates);
    if (saved === null) {
      throw new ProviderSettingsError(`Provider ${providerId} has no league ${leagueId}.`, 'PROVIDER_LEAGUE_NOT_FOUND');
    }
    const provider = await this.deps.repository.findById(providerId);
    if (provider !== null) this.deps.store.replace(provider);
    this.deps.logger?.info(
      { action: 'ingestion.providerSettings.leagueUpdated', providerId, providerLeagueId: leagueId, providerLeagueCode: saved.code, fields: Object.keys(updates) },
      'Updated a provider league\'s settings',
    );
    return saved;
  }
}

function notFound(providerId: string): ProviderSettingsError {
  return new ProviderSettingsError(`Provider ${providerId} was not found.`, 'PROVIDER_NOT_FOUND');
}
