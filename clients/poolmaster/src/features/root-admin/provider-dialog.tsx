import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Button,
  DateDisplay,
  DetailEditModal,
  FormField,
  HelpTip,
  Input,
  Select,
  showToast,
  type Fact,
} from '@/features/shared/ui';
import { OnOffField } from './on-off-field';
import type { ProviderSettingRangesDto, ProviderSettingsDto, ProviderSummaryDto } from '@/lib/api';
import { errorRateText, requestsPerMinuteText, webhooksText } from './provider-facts';
import { ProviderStatusChip } from './provider-status-chip';
import { useUpdateProviderSettings } from './use-update-provider';
import { wholeNumberIn } from './whole-number-field';

/** The settings form, held to the ranges the API sends. */
function settingsSchemaOf(ranges: ProviderSettingRangesDto | undefined) {
  return z.object({
    baseUrl: z.url({ protocol: /^https$/, error: 'Enter an https URL' }),
    requestsPerMinute: wholeNumberIn(ranges?.requestsPerMinute),
    webhooksEnabled: z.enum(['on', 'off']),
    webhookPollMinutes: wholeNumberIn(ranges?.pollMinutes),
    webhookRoundPollMinutes: wholeNumberIn(ranges?.pollMinutes),
    hasPlayerStats: z.enum(['yes', 'no']),
    isEnabled: z.enum(['on', 'off']),
    priority: wholeNumberIn(ranges?.priority),
  });
}

type SettingsValues = z.infer<ReturnType<typeof settingsSchemaOf>>;

function valuesOf(settings: ProviderSettingsDto): SettingsValues {
  return {
    baseUrl: settings.baseUrl,
    requestsPerMinute: String(settings.requestsPerMinute),
    webhooksEnabled: settings.webhooksEnabled ? 'on' : 'off',
    webhookPollMinutes: String(settings.webhookPollMinutes),
    webhookRoundPollMinutes: String(settings.webhookRoundPollMinutes),
    hasPlayerStats: settings.hasPlayerStats ? 'yes' : 'no',
    isEnabled: settings.isEnabled ? 'on' : 'off',
    priority: String(settings.priority),
  };
}

/** Only the changed settings, so a save never resends what another admin may have changed. */
function changesOf(values: SettingsValues, current: SettingsValues) {
  return {
    ...(values.baseUrl !== current.baseUrl && { baseUrl: values.baseUrl }),
    ...(values.requestsPerMinute !== current.requestsPerMinute && { requestsPerMinute: Number(values.requestsPerMinute) }),
    ...(values.webhooksEnabled !== current.webhooksEnabled && { webhooksEnabled: values.webhooksEnabled === 'on' }),
    ...(values.webhookPollMinutes !== current.webhookPollMinutes && { webhookPollMinutes: Number(values.webhookPollMinutes) }),
    ...(values.webhookRoundPollMinutes !== current.webhookRoundPollMinutes && { webhookRoundPollMinutes: Number(values.webhookRoundPollMinutes) }),
    ...(values.hasPlayerStats !== current.hasPlayerStats && { hasPlayerStats: values.hasPlayerStats === 'yes' }),
    ...(values.isEnabled !== current.isEnabled && { isEnabled: values.isEnabled === 'on' }),
    ...(values.priority !== current.priority && { priority: Number(values.priority) }),
  };
}

const minutes = (value: number) => (value === 1 ? '1 minute' : `${String(value)} minutes`);

/**
 * A provider's dialog (#1873, #1997): its health from its sync runs and its settings, then Edit for
 * its settings from its Provider row. Check now reads the list again, which checks every provider
 * live. A provider with no row has no Edit. Its API key and webhook secret stay
 * in Secrets Manager.
 */
export function ProviderDialog({
  checkedAt,
  isChecking,
  onCheckNow,
  onClose,
  provider,
  ranges,
}: {
  /** When the list holding this provider was read, which is when it was checked. */
  checkedAt: string;
  isChecking: boolean;
  onCheckNow: () => void;
  onClose: () => void;
  provider: ProviderSummaryDto;
  /** The ranges the API holds each setting to; undefined while they load. */
  ranges: ProviderSettingRangesDto | undefined;
}) {
  const testId = 'root-admin-provider-dialog';
  const settings = provider.settings;
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const current = settings === null ? null : valuesOf(settings);
  const settingsSchema = useMemo(() => settingsSchemaOf(ranges), [ranges]);
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    ...(current !== null && { defaultValues: current }),
    mode: 'onChange',
  });
  const updateMutation = useUpdateProviderSettings({
    providerId: settings?.id ?? '',
    onSuccess: () => {
      showToast({ title: `Saved ${provider.providerName}'s settings`, tone: 'success' });
      form.reset(form.getValues());
      setMode('view');
    },
  });

  const facts: Fact[] = [
    { id: 'status', label: 'Status', value: <ProviderStatusChip status={provider.status} /> },
    { id: 'checked', label: 'Checked', value: <DateDisplay value={checkedAt} /> },
    { id: 'error-rate', label: 'Error rate (1 h)', value: errorRateText(provider) },
    { id: 'rate-limited', label: 'Rate limited (24 h)', value: provider.rateLimitedJobsLast24h },
    { id: 'sport-leagues', label: 'Sport leagues', value: provider.syncedSportLeagueCount },
    { id: 'rate', label: 'Requests a minute', value: requestsPerMinuteText(provider), testId: `${testId}-rate` },
    { id: 'webhooks', label: 'Webhooks', value: webhooksText(provider), testId: `${testId}-webhooks` },
    ...(settings === null ? [] : [
      { id: 'enabled', label: 'Status setting', value: settings.isEnabled ? 'On' : 'Off', testId: `${testId}-enabled` },
      { id: 'base-url', label: 'Base URL', value: settings.baseUrl, testId: `${testId}-base-url` },
      { id: 'poll', label: 'Webhook safety-net poll', value: minutes(settings.webhookPollMinutes), testId: `${testId}-poll` },
      { id: 'round-poll', label: 'Webhook poll during a round', value: minutes(settings.webhookRoundPollMinutes), testId: `${testId}-round-poll` },
      { id: 'player-stats', label: 'Player stats', value: settings.hasPlayerStats ? 'In its plan' : 'Not in its plan', testId: `${testId}-player-stats` },
      { id: 'priority', label: 'Priority', value: settings.priority, testId: `${testId}-priority` },
    ]),
  ];

  const cancelEdit = () => {
    if (current !== null) form.reset(current);
    updateMutation.reset();
    setMode('view');
  };

  const title = (
    <span className="inline-flex items-center gap-2">
      {mode === 'view' ? provider.providerName : `${provider.providerName} · Edit`}
      <HelpTip label={`About ${provider.providerName}`} testId={`${testId}-help`}>
        {settings === null
          ? 'This provider is set up outside the Provider table, so its settings are not edited here.'
          : 'Its API key and webhook secret stay in Secrets Manager. The base URL, rate and polls reach every server within a minute; switching it on or off and its priority take effect when the servers next start.'}
      </HelpTip>
    </span>
  );

  return (
    <DetailEditModal
      canSave={form.formState.isValid && form.formState.isDirty}
      error={updateMutation.error}
      errorFallback="We could not save these settings."
      facts={facts}
      isPending={updateMutation.isPending}
      mode={mode}
      onCancel={onClose}
      onCancelEdit={cancelEdit}
      {...(settings !== null && { onEdit: () => setMode('edit') })}
      onOpenChange={(open) => (open ? undefined : onClose())}
      onSave={() => void form.handleSubmit((values) => current !== null && updateMutation.mutate(changesOf(values, current)))()}
      open
      pendingLabel="Saving..."
      saveLabel="Save settings"
      testId={testId}
      title={title}
      viewActions={(
        <Button data-testid={`${testId}-check`} disabled={isChecking} onClick={onCheckNow} type="button" variant="secondary">
          {isChecking ? 'Checking...' : 'Check now'}
        </Button>
      )}
    >
      <div className="grid gap-4">
        <OnOffField label="Status" registration={form.register('isEnabled')} testId={`${testId}-enabled-input`} />
        <FormField error={form.formState.errors.baseUrl?.message} label="Base URL">
          <Input data-testid={`${testId}-base-url-input`} {...form.register('baseUrl')} />
        </FormField>
        <FormField error={form.formState.errors.requestsPerMinute?.message} label="Requests a minute">
          <Input data-testid={`${testId}-rate-input`} inputMode="numeric" {...form.register('requestsPerMinute')} />
        </FormField>
        <OnOffField label="Webhooks" registration={form.register('webhooksEnabled')} testId={`${testId}-webhooks-input`} />
        <FormField error={form.formState.errors.webhookPollMinutes?.message} label="Webhook safety-net poll, minutes">
          <Input data-testid={`${testId}-poll-input`} inputMode="numeric" {...form.register('webhookPollMinutes')} />
        </FormField>
        <FormField error={form.formState.errors.webhookRoundPollMinutes?.message} label="Webhook poll during a round, minutes">
          <Input data-testid={`${testId}-round-poll-input`} inputMode="numeric" {...form.register('webhookRoundPollMinutes')} />
        </FormField>
        <FormField label="Player stats">
          <Select data-testid={`${testId}-player-stats-input`} {...form.register('hasPlayerStats')}>
            <option value="yes">In its plan</option>
            <option value="no">Not in its plan</option>
          </Select>
        </FormField>
        <FormField error={form.formState.errors.priority?.message} label="Priority">
          <Input data-testid={`${testId}-priority-input`} inputMode="numeric" {...form.register('priority')} />
        </FormField>
      </div>
    </DetailEditModal>
  );
}
