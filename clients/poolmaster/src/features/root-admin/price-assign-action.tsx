import { useMemo, useState } from 'react';
import {
  EventPricingConfigSchema,
  findBudgetPricingProblem,
  formatDollars,
  priceOnBudgetCurve,
  getSportDefinition,
  type BudgetPricingProfile,
  type EventPricingConfig,
  type Sport,
  type SportVocabulary,
} from '@poolmaster/shared/domain';
import { autoAssignEventPrices } from '@/lib/api';
import {
  Button,
  ConfirmationModal,
  FormField,
  Input,
  Select,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { useSettingsGroupsQuery } from './use-settings-groups';

/** The five values as the dialog's inputs hold them. */
type PricingDraft = Record<'salaryCap' | 'unit' | 'topSharePercent' | 'floorSharePercent' | 'steepness', string>;

/** The dialog's five inputs, worded for the event's sport. */
function valueFields({ event, participant }: SportVocabulary): ReadonlyArray<{ key: keyof PricingDraft; label: string; helper: string }> {
  return [
    { key: 'salaryCap', label: 'Salary cap ($)', helper: `Every budget contest on this ${event.one} uses it.` },
    { key: 'unit', label: 'Round prices to ($)', helper: 'Every price is a multiple of it.' },
    { key: 'topSharePercent', label: `Best ${participant.one} (% of cap)`, helper: 'The top seed\'s price.' },
    { key: 'floorSharePercent', label: `Worst ${participant.one} (% of cap)`, helper: `The last ${participant.one}'s price.` },
    { key: 'steepness', label: 'Steepness', helper: '1 is a straight line; higher keeps only the top few expensive.' },
  ];
}

function toDraft(values: BudgetPricingProfile | EventPricingConfig): PricingDraft {
  return {
    salaryCap: String(values.salaryCap),
    unit: String(values.unit),
    topSharePercent: String(values.topSharePercent),
    floorSharePercent: String(values.floorSharePercent),
    steepness: String(values.steepness),
  };
}

/** The values the dialog would send, or the first thing wrong with them. */
function parseDraft(profileName: string, draft: PricingDraft): { pricing: EventPricingConfig; error: null } | { pricing: null; error: string } {
  const parsed = EventPricingConfigSchema.safeParse({
    profileName,
    salaryCap: Number(draft.salaryCap),
    unit: Number(draft.unit),
    topSharePercent: Number(draft.topSharePercent),
    floorSharePercent: Number(draft.floorSharePercent),
    steepness: Number(draft.steepness),
  });
  if (!parsed.success) {
    return { pricing: null, error: 'Enter whole dollars for the cap and rounding, and shares and steepness above 0.' };
  }
  const problem = findBudgetPricingProblem(parsed.data);
  return problem ? { pricing: null, error: problem } : { pricing: parsed.data, error: null };
}

/**
 * Tiers page › Auto-assign prices (#93): prices the tournament's active field for budget contests
 * on the pricing curve, best seed first. The admin picks a Budget pricing profile (the default
 * first), may change any of its five values, and sees what the best and worst golfer will cost
 * before assigning. Repeatable until release; the values used are stored on the tournament.
 */
export function PriceAssignAction({
  activeParticipantCount,
  current,
  disabled,
  eventId,
  sport,
}: {
  activeParticipantCount: number;
  /** The values the tournament was last priced with, if any: the dialog starts from them. */
  current: EventPricingConfig | null;
  disabled: boolean;
  eventId: string;
  sport: Sport;
}) {
  const { vocabulary } = getSportDefinition(sport);
  const { event, participant } = vocabulary;
  const logger = getLogger().child({ feature: 'root-admin-sport-event-tiers-page' });
  const settingsQuery = useSettingsGroupsQuery();
  const profiles = useMemo(() => {
    const group = settingsQuery.data?.find((candidate) => candidate.key === 'BUDGET_PRICING_CONFIG');
    return group?.key === 'BUDGET_PRICING_CONFIG' ? group.value.profiles : [];
  }, [settingsQuery.data]);
  const [open, setOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [draft, setDraft] = useState<PricingDraft | null>(null);

  const mutation = useInvalidatingMutation({
    mutationFn: async (pricing: EventPricingConfig) => {
      const response = await autoAssignEventPrices({ path: { eventId }, body: pricing });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    // Prices land on the field's valuations; the tournament carries its pricing and readiness.
    invalidates: [
      QueryKeys.rootAdmin.manageSport.tiers(eventId),
      QueryKeys.rootAdmin.manageSport.field(eventId),
      QueryKeys.rootAdmin.manageSport.event(eventId),
    ],
    onSuccess: () => setOpen(false),
    onError: (error) => {
      logger.warn({ action: 'event.prices.autoAssign.failed', err: error }, 'Price auto-assign was rejected');
    },
  });

  function openDialog() {
    mutation.reset();
    if (current) {
      setProfileName(current.profileName);
      setDraft(toDraft(current));
    } else {
      const defaultProfile = profiles.at(0);
      setProfileName(defaultProfile?.name ?? '');
      setDraft(defaultProfile ? toDraft(defaultProfile) : null);
    }
    setOpen(true);
  }

  function chooseProfile(name: string) {
    const profile = profiles.find((candidate) => candidate.name === name);
    setProfileName(name);
    if (profile) {
      setDraft(toDraft(profile));
    }
  }

  const parsed = draft ? parseDraft(profileName, draft) : null;
  const preview = parsed?.pricing && activeParticipantCount > 0
    ? {
      best: priceOnBudgetCurve(parsed.pricing, 0, activeParticipantCount),
      worst: priceOnBudgetCurve(parsed.pricing, activeParticipantCount - 1, activeParticipantCount),
    }
    : null;
  const profileNames = profiles.some((profile) => profile.name === profileName) || !profileName
    ? profiles.map((profile) => profile.name)
    : [profileName, ...profiles.map((profile) => profile.name)];

  return (
    <>
      <Button
        data-testid="root-admin-tier-auto-prices"
        disabled={disabled || !profiles.length}
        onClick={openDialog}
        size="sm"
        variant="secondary"
      >
        Auto-assign prices
      </Button>
      <ConfirmationModal
        confirmLabel={current ? 'Replace prices' : 'Assign prices'}
        confirmTestId="root-admin-tier-auto-prices-confirm"
        description={`Every active ${participant.one} is priced from the best seed down, ${participant.many} with no seed last. Manual prices are replaced; tiers are untouched. You can price again until the ${event.one} is released.`}
        errorMessage={
          mutation.isError
            ? extractErrorMessage(mutation.error, { fallback: 'We could not assign prices.' })
            : parsed?.error ?? undefined
        }
        isConfirmDisabled={!parsed?.pricing}
        isPending={mutation.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={() => parsed?.pricing && mutation.mutate(parsed.pricing)}
        onOpenChange={(next) => !next && setOpen(false)}
        open={open}
        testId="root-admin-tier-auto-prices-modal"
        title="Auto-assign prices"
      >
        <div className="space-y-4">
          <FormField label="Pricing profile">
            <Select
              data-testid="root-admin-tier-auto-prices-profile"
              onChange={(event) => chooseProfile(event.target.value)}
              value={profileName}
            >
              {profileNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </Select>
          </FormField>
          {draft ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {valueFields(vocabulary).map((field) => (
                <FormField helperText={field.helper} key={field.key} label={field.label}>
                  <Input
                    data-testid={`root-admin-tier-auto-prices-${field.key}`}
                    inputMode="decimal"
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                    value={draft[field.key]}
                  />
                </FormField>
              ))}
            </div>
          ) : null}
          {preview ? (
            <p className="text-sm text-muted-foreground" data-testid="root-admin-tier-auto-prices-preview">
              {`Best ${participant.one} ${formatDollars(preview.best)}, worst ${formatDollars(preview.worst)}, across ${activeParticipantCount} active ${participant.many}.`}
            </p>
          ) : null}
        </div>
      </ConfirmationModal>
    </>
  );
}
