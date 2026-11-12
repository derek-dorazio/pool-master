import { Button, FormField, Input, Notice } from '@/features/shared/ui';

/** The longest entry name the server takes. */
const ENTRY_NAME_MAX_LENGTH = 100;

/**
 * The one rename-entry form (#1579): the entry page's name field and the contest page's Rename.
 * With `save` it carries its own Save name and Cancel; without, the page's Submit saves it.
 */
export function EntryNameField({
  disabled = false,
  error = null,
  onChange,
  save,
  testId,
  value,
}: {
  disabled?: boolean;
  /** Why the last save was refused, shown under the field. */
  error?: string | null;
  onChange: (value: string) => void;
  save?: {
    cancelTestId: string;
    isSaving: boolean;
    onCancel: () => void;
    onSave: (name: string) => void;
    saveTestId: string;
  };
  /** The input's test id. */
  testId: string;
  value: string;
}) {
  const isSaving = save?.isSaving ?? false;
  return (
    <div className="space-y-3">
      <FormField label="Entry name">
        <Input
          data-testid={testId}
          disabled={disabled || isSaving}
          maxLength={ENTRY_NAME_MAX_LENGTH}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        />
      </FormField>
      {save ? (
        <div className="flex flex-wrap gap-3">
          <Button
            data-testid={save.saveTestId}
            disabled={!value.trim() || isSaving}
            isLoading={isSaving}
            onClick={() => save.onSave(value.trim())}
          >
            {isSaving ? 'Saving...' : 'Save name'}
          </Button>
          <Button data-testid={save.cancelTestId} disabled={isSaving} onClick={save.onCancel} variant="secondary">
            Cancel
          </Button>
        </div>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}
