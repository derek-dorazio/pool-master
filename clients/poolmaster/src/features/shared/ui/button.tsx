import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "./class-names";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold uppercase tracking-button transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:opacity-90",
        secondary:
          "border border-border bg-background text-foreground hover:bg-muted/40",
        subtle:
          "border border-primary/30 bg-primary/10 text-foreground hover:border-primary/40 hover:bg-primary/15",
        ghost: "text-foreground hover:bg-muted/50",
        danger:
          "border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15",
        icon: "border border-border bg-background text-muted-foreground hover:bg-muted/40",
      },
      size: {
        auto: "min-h-12 px-4 py-3",
        xs: "h-7 min-w-7 rounded-md px-1.5",
        sm: "h-9 px-3",
        md: "h-12 px-4",
        lg: "h-14 px-5",
        icon: "h-12 w-12 p-0",
      },
      /**
       * `row` is a button drawn as a line of content rather than a call to action: sentence
       * case, full width, left aligned, and tall enough to wrap. Colour still comes from `variant`.
       */
      layout: {
        button: "",
        row: "w-full justify-start whitespace-normal text-left normal-case tracking-normal",
      },
    },
    compoundVariants: [
      { layout: "row", size: "sm", className: "h-auto min-h-9 py-1.5" },
      { layout: "row", size: "md", className: "h-auto min-h-12 py-2" },
      { layout: "row", size: "lg", className: "h-auto min-h-14 py-2" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
      layout: "button",
    },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    isLoading?: boolean;
  };

export function Button({
  asChild = false,
  children,
  className,
  disabled,
  isLoading = false,
  layout,
  size,
  type = "button",
  variant,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={cn(buttonVariants({ className, layout, size, variant }))}
      disabled={disabled || isLoading}
      type={asChild ? undefined : type}
      {...props}
    >
      {children}
    </Component>
  );
}

export type LinkButtonProps = LinkProps &
  VariantProps<typeof buttonVariants> & {
    isDisabled?: boolean;
  };

export function LinkButton({
  children,
  className,
  isDisabled = false,
  layout,
  size,
  variant,
  ...props
}: LinkButtonProps) {
  return (
    <Link
      aria-disabled={isDisabled}
      className={cn(
        buttonVariants({ className, layout, size, variant }),
        isDisabled ? "pointer-events-none opacity-60" : null,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}

export type MenuItemProps = Omit<ButtonProps, "layout" | "size" | "variant"> & {
  /** The entry that is current, such as the league being viewed. */
  isSelected?: boolean;
};

/** One entry in a dropdown menu: a quiet full-width row that tints when it is the current one. */
export function MenuItem({ className, isSelected = false, ...props }: MenuItemProps) {
  return (
    <Button
      className={cn("gap-3 rounded-xl px-3 font-medium", className)}
      layout="row"
      size="sm"
      variant={isSelected ? "subtle" : "ghost"}
      {...props}
    />
  );
}
