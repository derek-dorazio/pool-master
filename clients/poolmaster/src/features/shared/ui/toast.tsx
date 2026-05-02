import * as ToastPrimitive from "@radix-ui/react-toast";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./class-names";

export const ToastProvider = ToastPrimitive.Provider;

export function ToastViewport({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        "fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-3",
        className,
      )}
      {...props}
    />
  );
}

type ToastProps = Omit<ComponentPropsWithoutRef<typeof ToastPrimitive.Root>, "title"> & {
  description?: ReactNode;
  title: ReactNode;
  tone?: "default" | "danger" | "success";
};

function toastToneClassName(tone: ToastProps["tone"]) {
  if (tone === "danger") {
    return "border-destructive/40 bg-destructive/10";
  }

  if (tone === "success") {
    return "border-primary/30 bg-primary/10";
  }

  return "border-border bg-card";
}

export function Toast({
  className,
  description,
  title,
  tone = "default",
  ...props
}: ToastProps) {
  return (
    <ToastPrimitive.Root
      className={cn(
        "rounded-[1.25rem] border p-4 text-sm shadow-xl",
        toastToneClassName(tone),
        className,
      )}
      {...props}
    >
      <ToastPrimitive.Title className="font-semibold text-foreground">
        {title}
      </ToastPrimitive.Title>
      {description ? (
        <ToastPrimitive.Description className="mt-1 text-muted-foreground">
          {description}
        </ToastPrimitive.Description>
      ) : null}
    </ToastPrimitive.Root>
  );
}

type NotificationCardProps = {
  action?: ReactNode;
  body: ReactNode;
  className?: string;
  read?: boolean;
  title: ReactNode;
};

export function NotificationCard({
  action,
  body,
  className,
  read = false,
  title,
}: NotificationCardProps) {
  return (
    <article
      className={cn(
        "rounded-[1.25rem] border border-border bg-card p-4",
        !read && "border-primary/40 bg-primary/10",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        </div>
        {!read ? (
          <span
            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary"
            aria-label="Unread"
          />
        ) : null}
      </div>
      {action ? <div className="mt-3">{action}</div> : null}
    </article>
  );
}
