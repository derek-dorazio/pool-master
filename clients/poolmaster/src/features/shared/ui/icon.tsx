import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "./class-names";

const iconVariants = cva("shrink-0", {
  variants: {
    tone: {
      /** Takes the colour of the text around it. */
      inherit: "",
      default: "text-foreground",
      muted: "text-muted-foreground",
      primary: "text-primary",
      danger: "text-destructive",
    },
    /** Sits in a line of text, with a small gap before the words after it. */
    inline: {
      true: "mr-2 inline",
      false: "",
    },
  },
  defaultVariants: {
    inline: false,
    tone: "inherit",
  },
});

export type IconProps = Omit<LucideProps, "ref"> &
  VariantProps<typeof iconVariants> & {
    /** The lucide icon to draw. */
    icon: LucideIcon;
  };

/**
 * A decorative icon in one of the theme's text colours, so pages pick a tone instead of typing a
 * colour class. It is hidden from screen readers; give the control around it its name.
 */
export function Icon({ className, icon: Glyph, inline, tone, ...props }: IconProps) {
  return <Glyph aria-hidden className={cn(iconVariants({ className, inline, tone }))} {...props} />;
}
