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
      /** A titled block within a page or panel, such as a settings section or "Owners". */
      subtitle: "font-display text-lg font-extrabold",
      /** A small title over a group inside a card, such as a round or a form step. */
      label: "text-sm font-semibold",
      /** A group name set as a small uppercase line, like an `Eyebrow` that is also a heading. */
      eyebrow: "text-xs font-semibold uppercase tracking-eyebrow text-muted-foreground",
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

type HeadingVariant = NonNullable<VariantProps<typeof headingVariants>["variant"]>;
type CardSize = NonNullable<VariantProps<typeof headingVariants>["size"]>;

/** Only a card title takes a size; every other look is a fixed step on the scale. */
type HeadingLook =
  | { variant: "card"; size?: CardSize }
  | { variant: Exclude<HeadingVariant, "card">; size?: never };

export type HeadingProps = Omit<ComponentProps<"h1">, "color"> &
  Pick<VariantProps<typeof headingVariants>, "tone"> &
  HeadingLook & {
    level: HeadingLevel;
  };

export function Heading({ className, level, size, tone, variant, ...props }: HeadingProps) {
  const Tag = `h${level}` as const;
  const cardSize = variant === "card" ? size : undefined;
  // An eyebrow carries its own muted colour, so it takes no tone unless asked.
  const toneOrDefault = tone ?? (variant === "eyebrow" ? "inherit" : "default");
  return <Tag className={cn(headingVariants({ size: cardSize, tone: toneOrDefault, variant }), className)} {...props} />;
}
