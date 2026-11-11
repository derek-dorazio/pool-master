import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "./class-names";
import { EYEBROW_TYPE_CLASS_NAME } from "./type-styles";

const eyebrowVariants = cva(EYEBROW_TYPE_CLASS_NAME, {
  variants: {
    tone: {
      accent: "text-label",
      muted: "text-muted-foreground",
      /** On a navy panel, where the label blue would be too dark to read. */
      inverse: "text-label-on-inverse",
      /** The gold name of a tools area on its navy band: you are somewhere other than the member pages. */
      highlight: "text-primary",
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
