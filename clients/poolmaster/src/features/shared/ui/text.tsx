import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "./class-names";
import { EYEBROW_TYPE_CLASS_NAME } from "./type-styles";

const textVariants = cva("", {
  variants: {
    variant: {
      /** Running text: a sentence, a note, a cell's words. */
      body: "",
      /** The secondary line under a name: counts, dates, a team or entry line. */
      meta: "",
      /** A small aside: a timestamp, a count beside a tab, a footnote. */
      caption: "",
      /** A column header or field caption: the muted uppercase eyebrow look. */
      label: EYEBROW_TYPE_CLASS_NAME,
      /** A number or score, its digits lined up in a column. */
      value: "tabular-nums",
      /** A name that leads its row. */
      strong: "",
      /** The brand wordmark: the display face, black italic capitals. */
      wordmark: "font-display text-xl font-black uppercase italic tracking-normal sm:text-2xl",
      /** A link in the header's dark band: display face, bold capitals spaced like a button. */
      nav: "font-display text-sm font-bold uppercase tracking-button",
      /** A small display-face caption in the header's dark band, such as "League". */
      displayLabel: "font-display text-xs font-bold uppercase tracking-label",
      /** A name set in the display face, such as the league in the header. */
      display: "font-display font-bold",
      /** A big place numeral in the display face, such as the 1 on a podium step. */
      numeral: "font-display font-black",
    },
    tone: {
      /** The colour of the text around it, such as an alert's. */
      inherit: "",
      default: "text-foreground",
      muted: "text-muted-foreground",
      danger: "text-destructive",
      primary: "text-primary",
      /** Text on the header's dark band. */
      onInverse: "text-on-inverse",
      /** A caption on the dark band. */
      onInverseLabel: "text-label-on-inverse",
    },
    /** The colour on hover, or on hover or focus of the enclosing `group` link. */
    hoverTone: {
      none: "",
      primary: "hover:text-primary group-hover:text-primary group-focus-visible:text-primary",
      default: "hover:text-foreground",
    },
    /** The size, from the variant unless given; `inherit` keeps the size of the text around it. */
    size: {
      inherit: "",
      xs: "text-xs",
      sm: "text-sm",
      base: "text-base",
      lg: "text-lg",
      xl: "text-xl",
      /** Small on a phone, `sm` from the small breakpoint: a tile's line that must fit two lines two-across on a phone. */
      xsToSm: "text-xs sm:text-sm",
    },
    /** Emphasis: names and points that stand out in a row (`semibold`) or a total (`bold`). */
    weight: {
      normal: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
      bold: "font-bold",
    },
    truncate: {
      true: "truncate",
      false: "",
    },
  },
  defaultVariants: {
    variant: "body",
    truncate: false,
  },
});

/** Each variant's own colour, which `tone` overrides. */
const DEFAULT_TONES = {
  body: "inherit",
  caption: "muted",
  label: "muted",
  meta: "muted",
  numeral: "inherit",
  strong: "default",
  value: "default",
  wordmark: "onInverse",
  nav: "onInverse",
  displayLabel: "onInverseLabel",
  display: "inherit",
} as const;

type TextVariant = keyof typeof DEFAULT_TONES;

/** Each variant's own size, which `size` overrides. */
const DEFAULT_SIZES = {
  body: "sm",
  caption: "xs",
  label: "inherit",
  meta: "sm",
  numeral: "xl",
  strong: "sm",
  value: "sm",
  wordmark: "inherit",
  nav: "inherit",
  displayLabel: "inherit",
  display: "inherit",
} as const;

/** The variants that carry a weight of their own, which `weight` overrides. */
const DEFAULT_WEIGHTS: Partial<Record<TextVariant, "medium">> = {
  strong: "medium",
  value: "medium",
};

export type TextProps = HTMLAttributes<HTMLElement> &
  Omit<VariantProps<typeof textVariants>, "variant"> & {
    /** The element: a `span` inside a line, a `p` for a paragraph, a `div` for a block. */
    as?: "div" | "p" | "span";
    /** Styles its one child instead, such as a router `Link`, so a linked name keeps the look. */
    asChild?: boolean;
    variant?: TextVariant;
  };

/**
 * Every piece of text that is not a title (`Heading`) or the line over one (`Eyebrow`): body,
 * meta and caption lines, column labels, numbers and leading names, and the brand's display
 * type in the header. Pages pick a variant and, at most, a tone, a hover tone, a size and a
 * weight; the font, size, weight, case and colour live here.
 */
export function Text({
  as = "span",
  asChild = false,
  className,
  hoverTone,
  size,
  tone,
  truncate,
  variant = "body",
  weight,
  ...props
}: TextProps) {
  const Element = asChild ? Slot : as;
  return (
    <Element
      className={cn(
        textVariants({
          className,
          hoverTone,
          size: size ?? DEFAULT_SIZES[variant],
          tone: tone ?? DEFAULT_TONES[variant],
          truncate,
          variant,
          weight: weight ?? DEFAULT_WEIGHTS[variant],
        }),
      )}
      {...props}
    />
  );
}
