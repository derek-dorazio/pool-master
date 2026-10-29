import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./class-names";

/**
 * The type scale for titles. `variant` is the look and `level` the HTML tag, so a page can keep
 * a correct outline (one h1, then h2s) without that choice changing how a title looks.
 */
const headingVariants = cva("", {
  variants: {
    variant: {
      /** The one big line at the top of a landing page. */
      hero: "font-display text-3xl font-black italic leading-tight tracking-tight sm:text-4xl lg:text-5xl",
      /** A section title on a landing or event page. */
      display: "font-display text-3xl font-bold tracking-tight",
      /** The title of an app page, in normal case. */
      page: "text-3xl font-semibold tracking-tight",
      /** A section or dialog title that sits on the page, in normal case. */
      section: "text-xl font-semibold tracking-tight sm:text-2xl",
      /** A card or tile title: the house uppercase italic (`title-card`). */
      card: "title-card",
    },
    /** Text size for a card title, which takes its size from where it sits. */
    size: {
      sm: "text-sm",
      base: "text-base",
      lg: "text-lg",
      xl: "text-xl",
      "2xl": "text-2xl",
    },
    tone: {
      default: "text-foreground",
      primary: "text-primary",
      /** Takes the colour of what it sits on, such as a navy panel. */
      inherit: "",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type HeadingProps = Omit<ComponentProps<"h1">, "color"> &
  Required<Pick<VariantProps<typeof headingVariants>, "variant">> &
  Pick<VariantProps<typeof headingVariants>, "size" | "tone"> & {
    level: HeadingLevel;
  };

export function Heading({ className, level, size, tone, variant, ...props }: HeadingProps) {
  const Tag = `h${level}` as const;
  return <Tag className={cn(headingVariants({ size, tone, variant }), className)} {...props} />;
}
