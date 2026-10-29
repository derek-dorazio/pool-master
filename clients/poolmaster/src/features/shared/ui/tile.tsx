import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./class-names";

const tileVariants = cva("border", {
    variants: {
      variant: {
        default: "border-border bg-card",
        section: "border-border bg-card",
        subtle: "border-border bg-background",
        warning:
          "border-[color:var(--status-warning-border)] bg-[var(--status-warning-surface)] [color:var(--status-warning-text)]",
        danger:
          "border-[color:var(--status-danger-border)] bg-[var(--status-danger-surface)] [color:var(--status-danger-text)]",
        interactive:
          "border-border bg-[var(--workflow-default-surface)] transition hover:border-[color:var(--status-active-border)] hover:bg-[var(--workflow-default-hover-surface)]",
        /** The navy panel: a hero, a featured card, the next thing to do. */
        inverse: "border-inverse-border bg-surface-inverse text-on-inverse",
        /** The darker navy, for a panel inside a navy panel or a strip that sits apart. */
        inverseDeep: "border-inverse-border bg-surface-inverse-deep text-on-inverse",
      },
    padding: {
      none: "p-0",
      sm: "p-4",
      // Phones get less padding: cards nest, and every level would otherwise take 48px of a
      // 390px screen.
      md: "p-4 sm:p-6",
      lg: "p-5 sm:p-8",
    },
    radius: {
      md: "rounded-2xl",
      lg: "rounded-3xl",
      xl: "rounded-3xl sm:rounded-4xl",
    },
  },
  defaultVariants: {
    padding: "md",
    radius: "xl",
    variant: "default",
  },
});

export type TileProps = ComponentProps<"div"> &
  VariantProps<typeof tileVariants> & {
    /** `section` when the tile is a labelled region of the page, such as a hero. */
    as?: "div" | "section";
  };

export function Tile({ as: Tag = "div", className, padding, radius, variant, ...props }: TileProps) {
  return (
    <Tag
      className={cn(tileVariants({ className, padding, radius, variant }))}
      {...props}
    />
  );
}
