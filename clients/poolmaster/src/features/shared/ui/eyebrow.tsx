import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "./class-names";

const eyebrowVariants = cva("text-xs font-semibold uppercase tracking-eyebrow", {
  variants: {
    tone: {
      accent: "text-primary",
      muted: "text-muted-foreground",
    },
  },
  defaultVariants: {
    tone: "accent",
  },
});

export type EyebrowProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof eyebrowVariants>;

/** The small uppercase line over a title: a card's kind, an admin area's name, a menu group. */
export function Eyebrow({ className, tone, ...props }: EyebrowProps) {
  return <div className={cn(eyebrowVariants({ className, tone }))} {...props} />;
}
