import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./class-names";

export const TooltipProvider = TooltipPrimitive.Provider;

type TooltipProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Root> & {
  children: ReactNode;
  content: ReactNode;
  contentClassName?: string;
};

export function Tooltip({
  children,
  content,
  contentClassName,
  ...props
}: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root {...props}>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className={cn(
              "z-50 max-w-xs rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground shadow-xl",
              contentClassName,
            )}
            sideOffset={8}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-card" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

type HelpTextProps = {
  children: ReactNode;
  className?: string;
  id?: string;
};

export function HelpText({ children, className, id }: HelpTextProps) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} id={id}>
      {children}
    </p>
  );
}
