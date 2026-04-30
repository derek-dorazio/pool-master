import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./class-names";

const tileVariants = cva("border", {
  variants: {
    variant: {
      default: "border-border bg-card",
      section: "border-border bg-card",
      subtle: "border-border bg-background",
      warning: "border-border bg-muted/30 text-foreground",
      danger: "border-destructive/30 bg-destructive/10 text-destructive",
      interactive:
        "border-border bg-background transition hover:border-primary/40 hover:bg-card",
    },
    padding: {
      none: "p-0",
      sm: "p-4",
      md: "p-6",
      lg: "p-8",
    },
    radius: {
      md: "rounded-2xl",
      lg: "rounded-[1.5rem]",
      xl: "rounded-[2rem]",
    },
  },
  defaultVariants: {
    padding: "md",
    radius: "xl",
    variant: "default",
  },
});

export type TileProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof tileVariants>;

export const Tile = forwardRef<HTMLDivElement, TileProps>(function Tile(
  { className, padding, radius, variant, ...props },
  ref,
) {
  return (
    <div
      className={cn(tileVariants({ className, padding, radius, variant }))}
      ref={ref}
      {...props}
    />
  );
});
