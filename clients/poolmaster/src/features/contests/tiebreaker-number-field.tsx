import { GAME_PICKS_TIEBREAKER_MAX } from '@poolmaster/shared/dto';
import { FormField, Input } from '@/features/shared/ui';
import { parseBracketTiebreaker } from './bracket-layout';

/**
 * A pick'em week's or a bracket's tiebreaker (#1769): one number, the total of a named game's
 * score, typed in the Name and submit card and saved by its button. The label names the game:
 * "Tiebreaker · total points, SEA @ SF".
 */
export function TiebreakerNumberField({
  disabled = false,
  label,
  onChange,
  testId,
  text,
}: {
  disabled?: boolean;
  label: string;
  onChange: (text: string) => void;
  /** The input's test id. */
  testId: string;
  text: string;
}) {
  const isInvalid = text.trim() !== '' && parseBracketTiebreaker(text) === null;
  return (
    <FormField error={isInvalid ? `Enter a whole number from 0 to ${GAME_PICKS_TIEBREAKER_MAX}.` : undefined} label={label}>
      <Input
        data-testid={testId}
        disabled={disabled}
        inputMode="numeric"
        max={GAME_PICKS_TIEBREAKER_MAX}
        min={0}
        onChange={(event) => onChange(event.target.value)}
        type="number"
        value={text}
      />
    </FormField>
  );
}
