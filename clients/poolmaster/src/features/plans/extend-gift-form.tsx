import { useState, type ReactNode } from 'react';
import { Button, InlineError, Select } from '@/features/shared/ui';
import { PREVIEW_EXTEND_MONTHS, previewExtendMonthsLabel } from './preview-extend-months';


/**
 * "Extend free Premium" (#986), for a root admin: one league's gift on its settings page, or every
 * running gift on the leagues list. The gift then runs to the chosen months from today; a gift
 * that already runs later keeps its date.
 */
export function ExtendGiftForm({
  errorMessage,
  isPending,
  label,
  onExtend,
  result,
  testId,
}: {
  errorMessage: string | null;
  isPending: boolean;
  label: string;
  onExtend: (months: number) => void;
  /** What the last extension did, once it has. */
  result?: ReactNode;
  testId: string;
}) {
  const [months, setMonths] = useState<number>(PREVIEW_EXTEND_MONTHS[0]);
  return (
    <form
      className="space-y-2"
      data-testid={testId}
      onSubmit={(event) => {
        event.preventDefault();
        onExtend(months);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-foreground" htmlFor={`${testId}-months`}>{label}</label>
        <Select
          className="w-auto"
          data-testid={`${testId}-months`}
          disabled={isPending}
          id={`${testId}-months`}
          onChange={(event) => setMonths(Number(event.target.value))}
          value={months}
        >
          {PREVIEW_EXTEND_MONTHS.map((option) => (
            <option key={option} value={option}>
              {previewExtendMonthsLabel(option)}
            </option>
          ))}
        </Select>
        <Button data-testid={`${testId}-submit`} disabled={isPending} size="sm" type="submit" variant="secondary">
          {isPending ? 'Extending...' : 'Extend'}
        </Button>
      </div>
      {errorMessage ? <InlineError>{errorMessage}</InlineError> : null}
      {result ? <p className="text-sm text-muted-foreground" data-testid={`${testId}-result`} role="status">{result}</p> : null}
    </form>
  );
}
