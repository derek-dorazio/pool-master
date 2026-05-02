import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./class-names";

type ModalProps = {
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  contentClassName?: string;
  description?: ReactNode;
  descriptionId?: string;
  footer?: ReactNode;
  isCloseDisabled?: boolean;
  onClose?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  testId?: string;
  title: ReactNode;
  titleId?: string;
};

const modalSizeClassNames = {
  sm: "max-w-lg",
  md: "max-w-2xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

export function Modal({
  children,
  className,
  closeLabel = "Close modal",
  contentClassName,
  description,
  descriptionId,
  footer,
  isCloseDisabled = false,
  onClose,
  onOpenChange,
  open,
  size = "md",
  testId,
  title,
  titleId,
}: ModalProps) {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }

    const activeElement = document.activeElement;
    returnFocusRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
  }, [open]);

  function returnFocusToTrigger() {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;

    if (!target || !document.contains(target)) {
      return;
    }

    window.requestAnimationFrame(() => {
      target.focus();
    });
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isCloseDisabled) {
      return;
    }

    if (!nextOpen) {
      onClose?.();
      returnFocusToTrigger();
    }

    onOpenChange(nextOpen);
  }

  return (
    <Dialog.Root onOpenChange={handleOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={description ? descriptionId : undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[2rem] border border-border bg-card p-6 shadow-2xl",
            modalSizeClassNames[size],
            className,
          )}
          data-testid={testId}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <Dialog.Title
                className="text-2xl font-semibold tracking-tight"
                {...(titleId ? { id: titleId } : {})}
              >
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description
                  className="text-sm text-muted-foreground"
                  id={descriptionId}
                >
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button
                aria-label={closeLabel}
                disabled={isCloseDisabled}
                size="icon"
                type="button"
                variant="icon"
              >
                <X aria-hidden size={18} />
              </Button>
            </Dialog.Close>
          </div>

          <div className={cn("mt-6", contentClassName)}>{children}</div>

          {footer ? (
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
