import type { ReactNode } from 'react';
import { Button, Notice, SectionCard, Text } from '@/features/shared/ui';

/**
 * The one "what's left and submit" section on every pick page (#1579): its progress fact in the
 * title bar, the page's own fields and notices, a hint for what still blocks Submit, the Submit
 * button and why the last submit was refused. It always sits last on the page.
 */
export function EntrySubmitBar({
  children,
  error = null,
  errorTestId,
  hint = null,
  hintTestId,
  progress,
  progressTestId,
  submit,
  testId,
  title = 'Submit',
}: {
  /** The page's own fields and notices, above the hint and the button. */
  children?: ReactNode;
  /** Why the last submit was refused. */
  error?: ReactNode;
  errorTestId?: string;
  /** What still keeps Submit closed, in one sentence. */
  hint?: ReactNode;
  hintTestId?: string;
  /** How far the entry is: "6 of 8 picked". */
  progress?: ReactNode;
  progressTestId?: string;
  /** The Submit button, when the entry can submit now; null hides it. */
  submit?: {
    disabled: boolean;
    isSubmitting: boolean;
    label: string;
    onSubmit: () => void;
    testId: string;
  } | null;
  testId: string;
  title?: ReactNode;
}) {
  return (
    <SectionCard
      headingLevel={3}
      padded
      testId={testId}
      title={title}
      trailing={progress ? <Text data-testid={progressTestId} size="sm" variant="meta">{progress}</Text> : undefined}
    >
      <div className="space-y-4">
        {children}
        {hint ? <Text as="p" data-testid={hintTestId} variant="meta">{hint}</Text> : null}
        {submit ? (
          <Button
            className="w-full sm:w-auto"
            data-testid={submit.testId}
            disabled={submit.disabled}
            onClick={submit.onSubmit}
          >
            {submit.isSubmitting ? 'Submitting...' : submit.label}
          </Button>
        ) : null}
        {error ? <Notice data-testid={errorTestId} tone="danger">{error}</Notice> : null}
      </div>
    </SectionCard>
  );
}
