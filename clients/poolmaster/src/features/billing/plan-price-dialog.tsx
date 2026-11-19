import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import {
  Button,
  DetailEditModal,
  Eyebrow,
  FormField,
  Input,
  SimpleTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  formatMoneyCents,
  formatNumber,
  showToast,
  useDisplayPreferences,
} from '@/features/shared/ui';
import {
  MAX_EXPANSION_BANDS,
  PlanPriceFormSchema,
  describeEntriesIncluded,
  planPriceForm,
  withPlanPrices,
  type PlanPriceForm,
  type PlanPriceRow,
} from './plan-price-rows';
import { useSaveBillingConfig, type BillingSettingsGroup } from './use-save-billing-config';

/**
 * One plan's prices (#1886): its subscription and its expansion bands, with Close and Edit; Edit
 * changes the yearly and monthly prices and every band (add, remove, size, price), then Save sends
 * the whole payments settings with only this plan changed and comes back to the view
 * (rules/ux-rules.md §12 item 14). Entries included is the Plans page's, so it only reads here.
 */
export function PlanPriceDialog({
  group,
  onClose,
  row,
}: {
  group: BillingSettingsGroup;
  onClose: () => void;
  row: PlanPriceRow;
}) {
  const { locale } = useDisplayPreferences();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  // The version Edit started from, so a save over a newer one is refused, not lost.
  const [editedGroup, setEditedGroup] = useState(group);
  const testId = 'root-admin-plan-price-dialog';
  const form = useForm<PlanPriceForm>({
    resolver: zodResolver(PlanPriceFormSchema),
    defaultValues: planPriceForm(row),
    mode: 'onChange',
  });
  const bands = useFieldArray({ control: form.control, name: 'bands' });
  const errors = form.formState.errors;

  const saveMutation = useSaveBillingConfig({
    onSaved: () => {
      showToast({ title: `Saved ${row.label}'s prices`, tone: 'success' });
      setMode('view');
    },
  });

  const startEdit = () => {
    setEditedGroup(group);
    form.reset(planPriceForm(row));
    saveMutation.reset();
    setMode('edit');
  };

  const cancelEdit = () => {
    form.reset(planPriceForm(row));
    saveMutation.reset();
    setMode('view');
  };

  const save = form.handleSubmit((values) => saveMutation.mutate({
    value: withPlanPrices(editedGroup.value, row.plan, values),
    expectedUpdatedAt: editedGroup.updatedAt,
  }));

  return (
    <DetailEditModal
      canSave={form.formState.isValid && form.formState.isDirty}
      error={saveMutation.error}
      errorFallback={`We could not save ${row.label}'s prices.`}
      facts={[
        { id: 'yearly', label: 'Yearly', value: formatMoneyCents(row.yearlyCents, locale), testId: `${testId}-yearly` },
        { id: 'monthly', label: 'Monthly', value: formatMoneyCents(row.monthlyCents, locale), testId: `${testId}-monthly` },
        {
          id: 'entries-included',
          label: 'Entries included',
          value: describeEntriesIncluded(row.entriesIncluded, locale),
          detail: 'Set in Plans',
          testId: `${testId}-entries-included`,
        },
      ]}
      factsTitle="Subscription"
      isPending={saveMutation.isPending}
      mode={mode}
      onCancel={onClose}
      onCancelEdit={cancelEdit}
      onEdit={startEdit}
      onOpenChange={(open) => (open ? undefined : onClose())}
      onSave={() => void save()}
      open
      pendingLabel="Saving..."
      saveLabel="Save"
      testId={testId}
      title={mode === 'view' ? row.label : `${row.label} · Edit`}
      viewContent={(
        <div className="grid gap-2">
          <Eyebrow tone="muted">Expansion bands</Eyebrow>
          {row.bands.length === 0 ? (
            <Text data-testid={`${testId}-no-bands`} tone="muted">No expansions on this plan.</Text>
          ) : (
            <SimpleTable data-testid={`${testId}-bands`} density="compact">
              <TableHead>
                <TableRow>
                  <TableHeaderCell numeric>Expand to (entries)</TableHeaderCell>
                  <TableHeaderCell numeric>Price</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {row.bands.map((band) => (
                  <TableRow data-testid={`${testId}-band-${String(band.entriesPerContest)}`} key={band.entriesPerContest}>
                    <TableCell numeric>{formatNumber(band.entriesPerContest, locale)}</TableCell>
                    <TableCell numeric>{formatMoneyCents(band.priceCents, locale)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </SimpleTable>
          )}
        </div>
      )}
    >
      <div className="grid gap-5">
        <div className="grid gap-3">
          <Eyebrow tone="muted">Subscription</Eyebrow>
          <div className="flex flex-wrap gap-3">
            <FormField className="w-40" error={errors.yearly?.message} label="Yearly ($)">
              <Input data-testid={`${testId}-yearly-input`} step="0.01" type="number" {...form.register('yearly', { valueAsNumber: true })} />
            </FormField>
            <FormField className="w-40" error={errors.monthly?.message} label="Monthly ($)">
              <Input data-testid={`${testId}-monthly-input`} step="0.01" type="number" {...form.register('monthly', { valueAsNumber: true })} />
            </FormField>
          </div>
          <Text data-testid={`${testId}-entries-included-edit`} tone="muted">
            Entries included: {describeEntriesIncluded(row.entriesIncluded, locale)} (set in Plans)
          </Text>
        </div>
        <div className="grid gap-3">
          <Eyebrow tone="muted">Expansion bands</Eyebrow>
          {bands.fields.length === 0 ? <Text tone="muted">No expansions on this plan.</Text> : null}
          {bands.fields.map((band, index) => (
            <div className="flex flex-wrap items-end gap-3" data-testid={`${testId}-band-row-${String(index)}`} key={band.id}>
              <FormField className="w-40" error={errors.bands?.[index]?.entriesPerContest?.message} label="Expand to (entries)">
                <Input
                  data-testid={`${testId}-band-entries-${String(index)}`}
                  step="1"
                  type="number"
                  {...form.register(`bands.${index}.entriesPerContest`, { valueAsNumber: true })}
                />
              </FormField>
              <FormField className="w-40" error={errors.bands?.[index]?.dollars?.message} label="Price ($)">
                <Input
                  data-testid={`${testId}-band-price-${String(index)}`}
                  step="0.01"
                  type="number"
                  {...form.register(`bands.${index}.dollars`, { valueAsNumber: true })}
                />
              </FormField>
              <Button
                aria-label={`Remove band ${String(index + 1)}`}
                data-testid={`${testId}-band-remove-${String(index)}`}
                onClick={() => bands.remove(index)}
                size="xs"
                type="button"
                variant="icon"
              >
                <X aria-hidden size={14} />
              </Button>
            </div>
          ))}
          {bands.fields.length < MAX_EXPANSION_BANDS ? (
            <div>
              <Button
                data-testid={`${testId}-band-add`}
                onClick={() => bands.append({ entriesPerContest: Number.NaN, dollars: Number.NaN })}
                size="sm"
                type="button"
                variant="secondary"
              >
                + Add band
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </DetailEditModal>
  );
}
