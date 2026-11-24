/**
 * Whether each provider's webhooks are on (#1997): its Provider row is enabled with
 * `webhooksEnabled`, and its signing secret is set in this environment (Secrets Manager, through
 * the task definition). The flag without the secret is refused on the Providers page and logged
 * at startup; slice 2 raises it as an ERROR finding.
 */
import type { FastifyBaseLogger } from 'fastify';
import { providerSourceIdOf, type ProviderCode, type ProviderSettings } from '@poolmaster/shared/domain';
import { providerByCode } from './provider-settings-store';

/** Each provider's webhook signing secret, by its code; a provider with none set is left out. */
export type ProviderWebhookSecrets = Readonly<Partial<Record<ProviderCode, string>>>;

export class ProviderWebhookSwitch {
  constructor(
    private readonly providers: { all(): readonly ProviderSettings[] },
    private readonly secrets: ProviderWebhookSecrets,
  ) {}

  /** Whether the provider's signing secret is set here. */
  isSecretSet(code: ProviderCode): boolean {
    return this.secrets[code] !== undefined;
  }

  /** The provider's signing secret while its webhooks are on; undefined otherwise. */
  activeSecret(code: ProviderCode): string | undefined {
    const provider = providerByCode(this.providers.all(), code);
    return provider !== undefined && isOn(provider) ? this.secrets[code] : undefined;
  }

  /** Whether the provider's webhooks are on. */
  isOn(provider: Pick<ProviderSettings, 'code' | 'isEnabled' | 'webhooksEnabled'>): boolean {
    return isOn(provider) && this.isSecretSet(provider.code);
  }

  /** The providers whose webhooks are on, by the id their events carry. */
  onProviderIds(): readonly string[] {
    return this.providers.all().filter((provider) => this.isOn(provider)).map((provider) => providerSourceIdOf(provider.code));
  }

  /** Logs each provider whose webhooks are switched on while its signing secret is not set. */
  warnFlagsWithoutSecret(logger?: FastifyBaseLogger): void {
    for (const provider of this.providers.all()) {
      if (isOn(provider) && !this.isSecretSet(provider.code)) {
        logger?.error(
          { action: 'ingestion.providerWebhooks.secretMissing', providerCode: provider.code },
          'A provider\'s webhooks are switched on but its signing secret is not set, so its notifications are refused',
        );
      }
    }
  }
}

function isOn(provider: Pick<ProviderSettings, 'isEnabled' | 'webhooksEnabled'>): boolean {
  return provider.isEnabled && provider.webhooksEnabled;
}
