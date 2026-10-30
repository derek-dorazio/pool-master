import { useState, type ReactNode } from 'react';
import { Button, InlineError, Select } from '@/features/shared/ui';

/** How far a root admin can extend a gifted plan, in months from today (#986). */
const EXTEND_MONTHS = [1, 3, 6, 12] as const;

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
  const [months, setMonths] = useState<number>(EXTEND_MONTHS[0]);
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
          {EXTEND_MONTHS.map((option) => (
            <option key={option} value={option}>
              {option === 1 ? '1 month from today' : `${option} months from today`}
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
