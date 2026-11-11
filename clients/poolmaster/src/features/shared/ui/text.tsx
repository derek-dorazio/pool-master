import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "./class-names";
import { EYEBROW_TYPE_CLASS_NAME } from "./type-styles";

const textVariants = cva("", {
  variants: {
    variant: {
      /** Running text: a sentence, a note, a cell's words. */
      body: "text-sm",
      /** The secondary line under a name: counts, dates, a team or entry line. */
      meta: "text-sm",
      /** A small aside: a timestamp, a count beside a tab, a footnote. */
      caption: "text-xs",
      /** A column header or field caption: the muted uppercase eyebrow look. */
      label: EYEBROW_TYPE_CLASS_NAME,
      /** A number or score, its digits lined up in a column. */
      value: "text-sm tabular-nums",
      /** A name that leads its row. */
      strong: "text-sm",
    },
    tone: {
      default: "text-foreground",
      muted: "text-muted-foreground",
      danger: "text-destructive",
      primary: "text-primary",
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
  body: "default",
  caption: "muted",
  label: "muted",
  meta: "muted",
  strong: "default",
  value: "default",
} as const;

type TextVariant = keyof typeof DEFAULT_TONES;

/** The variants that carry a weight of their own, which `weight` overrides. */
const DEFAULT_WEIGHTS: Partial<Record<TextVariant, "medium">> = {
  strong: "medium",
  value: "medium",
};

export type TextProps = HTMLAttributes<HTMLElement> &
  Omit<VariantProps<typeof textVariants>, "variant"> & {
    /** The element: a `span` inside a line, a `p` for a paragraph, a `div` for a block. */
    as?: "div" | "p" | "span";
    variant?: TextVariant;
  };

/**
 * Every piece of text that is not a title (`Heading`) or the line over one (`Eyebrow`): body,
 * meta and caption lines, column labels, numbers and leading names. Pages pick a variant and,
 * at most, a tone and a weight; the font, size, weight, case and colour live here.
 */
export function Text({ as: Element = "span", className, tone, truncate, variant = "body", weight, ...props }: TextProps) {
  return (
    <Element
      className={cn(
        textVariants({ className, tone: tone ?? DEFAULT_TONES[variant], truncate, variant, weight: weight ?? DEFAULT_WEIGHTS[variant] }),
      )}
      {...props}
    />
  );
}
