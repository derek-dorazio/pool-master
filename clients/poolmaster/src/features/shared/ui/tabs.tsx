import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./class-names";

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex rounded-2xl border border-border bg-background p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground transition data-[state=active]:bg-card data-[state=active]:text-foreground disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;

type SegmentedControlOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

type SegmentedControlProps = {
  "aria-label": string;
  onChange: (value: string) => void;
  options: SegmentedControlOption[];
  value: string;
};

export function SegmentedControl({
  "aria-label": ariaLabel,
  onChange,
  options,
  value,
}: SegmentedControlProps) {
  return (
    <div
      aria-label={ariaLabel}
      className="inline-flex rounded-2xl border border-border bg-background p-1"
      role="radiogroup"
    >
      {options.map((option) => (
        <button
          aria-checked={value === option.value}
          className={cn(
            "rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground transition disabled:cursor-not-allowed disabled:opacity-60",
            value === option.value
              ? "bg-card text-foreground"
              : "hover:bg-muted/40",
          )}
          disabled={option.disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
