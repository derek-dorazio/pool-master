import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "./class-names";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-2xl text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60",
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
        sm: "h-9 px-3",
        md: "h-12 px-4",
        lg: "h-14 px-5",
        icon: "h-12 w-12 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    isLoading?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      asChild = false,
      children,
      className,
      disabled,
      isLoading = false,
      size,
      type = "button",
      variant,
      ...props
    },
    ref,
  ) {
    const Component = asChild ? Slot : "button";

    return (
      <Component
        className={cn(buttonVariants({ className, size, variant }))}
        disabled={disabled || isLoading}
        ref={ref}
        type={asChild ? undefined : type}
        {...props}
      >
        {children}
      </Component>
    );
  },
);

export type LinkButtonProps = LinkProps &
  VariantProps<typeof buttonVariants> & {
    isDisabled?: boolean;
  };

export function LinkButton({
  children,
  className,
  isDisabled = false,
  size,
  variant,
  ...props
}: LinkButtonProps) {
  return (
    <Link
      aria-disabled={isDisabled}
      className={cn(
        buttonVariants({ className, size, variant }),
        isDisabled ? "pointer-events-none opacity-60" : null,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
