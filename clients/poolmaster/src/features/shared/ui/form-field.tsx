import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "./class-names";

type FormFieldProps = {
  children: ReactNode;
  className?: string;
  error?: ReactNode;
  helperText?: ReactNode;
  id?: string;
  label: ReactNode;
  labelAddon?: ReactNode;
};

export function FormField({
  children,
  className,
  error,
  helperText,
  id,
  label,
  labelAddon,
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
        <label className="text-sm font-medium" htmlFor={fieldId}>
          {label}
        </label>
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
