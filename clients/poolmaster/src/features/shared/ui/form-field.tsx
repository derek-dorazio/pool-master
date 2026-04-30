import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
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
  const renderedChildren = isValidElement(children)
    ? cloneElement(
        children as ReactElement<{
          "aria-describedby"?: string;
          "aria-invalid"?: boolean;
          id?: string;
        }>,
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
  "w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:opacity-70";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input className={cn(controlClassName, className)} ref={ref} {...props} />
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        className={cn(controlClassName, className)}
        ref={ref}
        {...props}
      />
    );
  },
);

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        className={cn(controlClassName, "min-h-24", className)}
        ref={ref}
        {...props}
      />
    );
  },
);
