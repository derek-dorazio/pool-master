import { Eye, EyeOff } from "lucide-react";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button } from "./button";
import { cn } from "./class-names";
import { HelpTip } from "./help-tip";

type FormFieldProps = {
  children: ReactNode;
  className?: string;
  error?: ReactNode;
  /** How the field works, behind a (?) after the label: never a sentence under the field. */
  help?: ReactNode;
  /** One short line about format or result only. */
  helperText?: ReactNode;
  id?: string;
  label: ReactNode;
  labelAddon?: ReactNode;
  /** Says "(optional)" after the label. A required field carries no mark. */
  optional?: boolean;
};

export function FormField({
  children,
  className,
  error,
  help,
  helperText,
  id,
  label,
  labelAddon,
  optional = false,
}: FormFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const helperTextId = helperText ? `${fieldId}-helper` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy =
    [helperTextId, errorId].filter(Boolean).join(" ") || undefined;
  const renderedChildren = isValidElement<{
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    id?: string;
  }>(children)
    ? cloneElement(
        children,
        {
          "aria-describedby": describedBy,
          "aria-invalid": Boolean(error) || undefined,
          id: children.props.id ?? fieldId,
        },
      )
    : children;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5">
          <label className="text-sm font-medium" htmlFor={fieldId}>
            {label}
            {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
          </label>
          {help ? (
            <HelpTip label={`About ${typeof label === "string" ? label : "this field"}`} testId={`${fieldId}-help`}>
              {help}
            </HelpTip>
          ) : null}
        </span>
        {labelAddon ? (
          <div className="text-xs text-muted-foreground">{labelAddon}</div>
        ) : null}
      </div>
      {renderedChildren}
      {helperText ? (
        <p className="text-xs text-muted-foreground" id={helperTextId}>
          {helperText}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlClassName =
  "w-full rounded-2xl border border-border bg-background px-4 py-3 text-base text-foreground outline-none sm:text-sm transition placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:opacity-70";

export type InputProps = ComponentProps<"input">;

export function Input({ className, ...props }: InputProps) {
  return <input className={cn(controlClassName, className)} {...props} />;
}

export type PasswordInputProps = Omit<InputProps, "type">;

/**
 * A password box with an eye button inside its right edge that shows or hides what was typed.
 * It starts hidden. The button's name stays "Show password" and `aria-pressed` says whether it
 * is on, so a screen reader hears one control with a state rather than a label that flips.
 */
export function PasswordInput({ className, id, ...props }: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [isVisible, setIsVisible] = useState(false);
  const Icon = isVisible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input
        className={cn("pr-14", className)}
        id={inputId}
        {...props}
        type={isVisible ? "text" : "password"}
      />
      <Button
        aria-controls={inputId}
        aria-label="Show password"
        aria-pressed={isVisible}
        className="absolute right-1 top-1/2 h-10 w-10 -translate-y-1/2 rounded-xl"
        disabled={props.disabled}
        onClick={() => setIsVisible((visible) => !visible)}
        size="icon"
        variant="ghost"
      >
        <Icon aria-hidden className="text-muted-foreground" size={18} />
      </Button>
    </div>
  );
}

export type CheckboxProps = Omit<
  ComponentProps<"input">,
  "type"
> & {
  /** Tri-state visual: overrides `checked` styling when a subset is selected. */
  indeterminate?: boolean;
};

export function Checkbox({
  className,
  indeterminate = false,
  ref,
  ...props
}: CheckboxProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (innerRef.current) {
      innerRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      className={cn(
        "h-4 w-4 shrink-0 rounded border border-border bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70",
        className,
      )}
      ref={(node) => {
        innerRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      }}
      type="checkbox"
      {...props}
    />
  );
}

export type SelectProps = ComponentProps<"select">;

export function Select({ className, ...props }: SelectProps) {
  return <select className={cn(controlClassName, className)} {...props} />;
}

export type TextareaProps = ComponentProps<"textarea">;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea className={cn(controlClassName, "min-h-24", className)} {...props} />
  );
}
