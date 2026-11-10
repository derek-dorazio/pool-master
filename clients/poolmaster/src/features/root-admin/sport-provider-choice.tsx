import { FormField, Select } from '@/features/shared/ui';
import type { SportProviderOption } from './sport-admin-utils';

/**
 * Chooses which provider's catalog to browse when more than one covers the sport (the QA mock
 * beside BALLDONTLIE, #1495). Renders nothing for a sport with one provider or none, so the
 * default provider needs no choice.
 */
export function SportProviderChoice({
  onChange,
  providerId,
  providers,
  testId,
}: {
  onChange: (providerId: string) => void;
  providerId: string | null;
  providers: readonly SportProviderOption[];
  testId: string;
}) {
  if (providers.length < 2) {
    return null;
  }
  return (
    <FormField label="Provider">
      <Select
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
        value={providerId ?? ''}
      >
        {providers.map((provider) => (
          <option key={provider.providerId} value={provider.providerId}>
            {provider.providerName}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
