import { useRef, type ReactNode } from 'react';
import { Button, Notice, SectionCard, StickyActionBar, Text } from '@/features/shared/ui';
import { EntryNameField } from './entry-name-field';

/** The card's one button: Submit (or Submit week, Submit bracket), or Save once nothing is left to submit. */
export type EntryFinishAction = {
  disabled: boolean;
  isBusy: boolean;
  label: string;
  onClick: () => void;
  testId: string;
};

/**
 * The last card on every pick screen (#1769): the entry's name, the tiebreaker where the contest
 * has one, a short status (when to submit by, what still blocks it, or that it is submitted) and
 * the one button that saves all of it. A type with nothing to submit, such as a random draw, titles
 * it Entry name and keeps only the name. On a phone, while the card is out of view, a slim bar at
 * the bottom of the screen keeps the status and the button in reach.
 */
export function EntryFinishCard({
  action,
  children,
  error = null,
  errorTestId,
  name,
  status,
  statusTestId,
  testId,
  title,
}: {
  /** The card's button, or null when there is nothing to save or submit now. */
  action: EntryFinishAction | null;
  /** The page's own fields under the name, such as the tiebreaker. */
  children?: ReactNode;
  /** Why the last save or submit was refused. */
  error?: string | null;
  errorTestId?: string;
  /** The entry's name, while it can change; null leaves it off. */
  name: { disabled?: boolean; onChange: (name: string) => void; testId: string; value: string } | null;
  /** One short line beside the button: "Submit by Thu 8:15 PM", "✓ Submitted · change until kickoff". */
  status: ReactNode;
  statusTestId?: string;
  testId: string;
  title: 'Entry name' | 'Name and submit';
}) {
  const card = useRef<HTMLDivElement>(null);
  const label = action?.isBusy ? 'Saving...' : action?.label;
  return (
    <div ref={card}>
      <SectionCard headingLevel={3} padded testId={testId} title={title}>
        <div className="space-y-4">
          {name ? (
            <EntryNameField disabled={name.disabled} onChange={name.onChange} testId={name.testId} value={name.value} />
          ) : null}
          {children}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text data-testid={statusTestId} variant="meta">{status}</Text>
            {action ? (
              <Button className="w-full sm:w-auto" data-testid={action.testId} disabled={action.disabled} onClick={action.onClick}>
                {label}
              </Button>
            ) : null}
          </div>
          {error ? <Notice data-testid={errorTestId} tone="danger">{error}</Notice> : null}
        </div>
      </SectionCard>
      {action ? (
        <StickyActionBar testId={`${testId}-sticky`} watch={card}>
          <div className="flex items-center justify-between gap-3">
            <Text data-testid={`${testId}-sticky-status`} variant="meta">{status}</Text>
            <Button data-testid={`${action.testId}-sticky`} disabled={action.disabled} onClick={action.onClick} size="sm">
              {label}
            </Button>
          </div>
        </StickyActionBar>
      ) : null}
    </div>
  );
}
