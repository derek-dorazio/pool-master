import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import { cn } from "./class-names";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 8, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn(
          "z-50 min-w-56 rounded-[1.5rem] border border-border bg-card p-2 shadow-xl",
          className,
        )}
        ref={ref}
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(function DropdownMenuItem({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center rounded-xl px-3 py-2 text-sm font-medium text-foreground outline-none transition focus:bg-muted/50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

type SelectorOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

type SelectorProps = {
  "aria-label"?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: SelectorOption[];
  value: string;
};

export function Selector({
  "aria-label": ariaLabel,
  disabled = false,
  onChange,
  options,
  value,
}: SelectorProps) {
  return (
    <select
      aria-label={ariaLabel}
      className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {options.map((option) => (
        <option
          disabled={option.disabled}
          key={option.value}
          value={option.value}
        >
          {option.label}
        </option>
      ))}
    </select>
  );
}
