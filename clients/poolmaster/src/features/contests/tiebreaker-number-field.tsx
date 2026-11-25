import { FormField, Input } from '@/features/shared/ui';
import { parseBracketTiebreaker } from './bracket-layout';

/**
 * A pick'em week's or a bracket's tiebreaker (#1769): one number, the total of a named game's
 * score, typed in the Name and submit card and saved by its button. The label names the game:
 * "Tiebreaker · total points, SEA @ SF".
 *
 * Not `TiebreakerField` (contest-entry-selection.tsx): a roster contest picks its tiebreaker from
 * the options its scoring family lists, in a select, and saves it with the entry details.
 */
export function TiebreakerNumberField({
  disabled = false,
  label,
  max,
  onChange,
  testId,
  text,
}: {
  disabled?: boolean;
  label: string;
  /** The highest tiebreaker the server takes, from the picks read (`tiebreakerMax`). */
  max: number;
  onChange: (text: string) => void;
  /** The input's test id. */
  testId: string;
  text: string;
}) {
  const isInvalid = text.trim() !== '' && parseBracketTiebreaker(text, max) === null;
  return (
    <FormField error={isInvalid ? `Enter a whole number from 0 to ${String(max)}.` : undefined} label={label}>
      <Input
        data-testid={testId}
        disabled={disabled}
        inputMode="numeric"
        max={max}
        min={0}
        onChange={(event) => onChange(event.target.value)}
        type="number"
        value={text}
      />
    </FormField>
  );
}
