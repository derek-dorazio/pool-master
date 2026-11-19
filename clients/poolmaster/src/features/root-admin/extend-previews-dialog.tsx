import { useState } from 'react';
import { extendRunningPlanRenewals } from '@/lib/api';
import { Button, ConfirmDialog, FormField, Select, formatDateDisplay, showToast, useDisplayPreferences } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { PREVIEW_EXTEND_MONTHS, previewExtendMonthsLabel } from '@/features/plans/preview-extend-months';

const TEST_ID = 'root-admin-customers-extend-previews';

/**
 * Customers › Leagues' header button (#1883): "Extend every running Premium preview" confirms the
 * months from today, then moves every league's running preview out at once. A preview that
 * already runs later keeps its date (#986).
 */
export function ExtendPreviewsButton() {
  const displayPreferences = useDisplayPreferences();
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState<number>(PREVIEW_EXTEND_MONTHS[0]);

  const extendMutation = useInvalidatingMutation({
    mutationFn: async (chosen: number) => {
      const response = await extendRunningPlanRenewals({ body: { months: chosen } });
      if (!response.data) {
        throwApiError(response.error, 'Plan extension response is missing data.');
      }
      return response.data;
    },
    onSuccess: (result) => {
      const leagues = result.extendedCount === 1 ? '1 league' : `${String(result.extendedCount)} leagues`;
      showToast({
        title: `${leagues} now have a Premium preview ending on ${formatDateDisplay(result.renewsAt, displayPreferences)}`,
        tone: 'success',
      });
      setOpen(false);
    },
    invalidates: [QueryKeys.rootAdmin.manageLeagues, QueryKeys.leagues.all],
  });

  const close = () => {
    extendMutation.reset();
    setOpen(false);
  };

  return (
    <>
      <Button
        data-testid={`${TEST_ID}-open`}
        onClick={() => {
          extendMutation.reset();
          setMonths(PREVIEW_EXTEND_MONTHS[0]);
          setOpen(true);
        }}
        size="sm"
        variant="secondary"
      >
        Extend every running Premium preview
      </Button>
      <ConfirmDialog
        confirmLabel="Extend"
        confirmTestId={`${TEST_ID}-submit`}
        description="Every league whose Premium preview still runs gets it to the months picked from today. A preview that already ends later keeps its date."
        error={extendMutation.isError ? extractErrorMessage(extendMutation.error, { fallback: 'We could not extend the previews.' }) : null}
        isPending={extendMutation.isPending}
        onCancel={close}
        onConfirm={() => extendMutation.mutate(months)}
        onOpenChange={(next) => (next ? undefined : close())}
        open={open}
        pendingLabel="Extending..."
        testId={`${TEST_ID}-dialog`}
        title="Extend every running Premium preview?"
      >
        <FormField label="Extend to">
          <Select data-testid={`${TEST_ID}-months`} onChange={(event) => setMonths(Number(event.target.value))} value={months}>
            {PREVIEW_EXTEND_MONTHS.map((option) => (
              <option key={option} value={option}>
                {previewExtendMonthsLabel(option)}
              </option>
            ))}
          </Select>
        </FormField>
      </ConfirmDialog>
    </>
  );
}
