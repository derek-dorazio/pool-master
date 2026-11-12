import { cn } from "./class-names";

export type SwitchProps = {
  checked: boolean;
  disabled?: boolean;
  /** What it turns on, for a screen reader, such as "Contest updates". */
  label: string;
  onCheckedChange: (checked: boolean) => void;
  testId?: string;
};

/**
 * An on/off switch for a setting that takes effect the moment it is flipped, such as an email
 * notification: a track with a sliding knob, filled when on. A choice saved with a form is a
 * `Checkbox` instead.
 */
export function Switch({ checked, disabled = false, label, onCheckedChange, testId }: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "bg-primary" : "bg-input",
      )}
      data-state={checked ? "checked" : "unchecked"}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
