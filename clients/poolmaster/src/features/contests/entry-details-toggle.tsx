import { Button } from '@/features/shared/ui';

/**
 * The toolbar button over a contest page's entries (#1739): "Show all details" opens every row
 * that has details, and once they all are, "Hide all details" closes them.
 */
export function EntryDetailsToggle({
  allOpen,
  onToggle,
  testId,
}: {
  allOpen: boolean;
  onToggle: (open: boolean) => void;
  testId: string;
}) {
  return (
    <Button data-testid={testId} onClick={() => onToggle(!allOpen)} size="sm" variant="secondary">
      {allOpen ? 'Hide all details' : 'Show all details'}
    </Button>
  );
}
