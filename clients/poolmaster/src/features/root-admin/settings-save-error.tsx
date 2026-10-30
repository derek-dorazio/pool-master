import { Alert, Button } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';

/**
 * Why a settings form's save failed, with a button to load the newer version when someone else
 * saved first. Nothing while the last save has not failed.
 */
export function SettingsSaveError({
  conflicted,
  error,
  fallback,
  loadLabel = 'Load the latest settings',
  onLoadLatest,
  testId,
}: {
  conflicted: boolean;
  error: Error | null;
  /** What the alert says when the server gives no reason of its own. */
  fallback: string;
  loadLabel?: string;
  onLoadLatest: () => Promise<void>;
  testId: string;
}) {
  if (!error) {
    return null;
  }
  return (
    <Alert
      action={conflicted ? (
        <Button onClick={() => void onLoadLatest()} type="button" variant="secondary">
          {loadLabel}
        </Button>
      ) : undefined}
      data-testid={testId}
      tone="danger"
    >
      {extractErrorMessage(error, { fallback })}
    </Alert>
  );
}
