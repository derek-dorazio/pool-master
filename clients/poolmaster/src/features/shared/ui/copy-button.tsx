import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { getLogger } from "@/lib/logger";
import { Button, type ButtonProps } from "./button";
import { InlineError } from "./state";

/** How long "Copied" shows before the button goes back to its label. */
const COPIED_RESET_MS = 2000;

type CopyState = "copied" | "failed" | "idle";

export type CopyButtonProps = Pick<ButtonProps, "className" | "disabled" | "size" | "variant"> & {
  /** What lands on the clipboard. */
  text: string;
  /** The button's words; an icon-only button uses them as its accessible name. */
  label: string;
  copiedLabel?: string;
  /** Shown under the button when the browser refuses the clipboard, so the reader can copy by hand. */
  failedMessage?: ReactNode;
  /** Just the copy icon, for a tight spot such as a table row or beside a code. */
  iconOnly?: boolean;
  testId?: string;
};

/**
 * Copies `text` and says so: an icon-only button's copy icon turns to a check, a labelled one's
 * words to `copiedLabel`, for a moment. A labelled one has no icon, so a long label such as
 * "Share with your commissioner" still fits a phone on one line. When the clipboard is refused
 * (an insecure origin, a denied permission) it says that instead, in place, and logs it.
 */
export function CopyButton({
  className,
  copiedLabel = "Copied",
  disabled,
  failedMessage = "Couldn't copy. Select the text and copy it by hand.",
  iconOnly = false,
  label,
  size,
  testId,
  text,
  variant = "secondary",
}: CopyButtonProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    if (copyState !== "copied") {
      return;
    }
    const timer = setTimeout(() => setCopyState("idle"), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copyState]);

  async function handleCopy() {
    try {
      // Missing on a plain-http origin, though the DOM types say it never is.
      const clipboard = navigator.clipboard as Clipboard | undefined;
      if (!clipboard) {
        throw new Error("The Clipboard API is not available on this page.");
      }
      await clipboard.writeText(text);
      setCopyState("copied");
    } catch (err) {
      getLogger().warn({ action: "clipboard.copy.failed", err }, "Copy to clipboard was refused");
      setCopyState("failed");
    }
  }

  const isCopied = copyState === "copied";
  const Icon = isCopied ? Check : Copy;

  return (
    <span className="relative inline-flex flex-col gap-1">
      <Button
        aria-label={iconOnly ? label : undefined}
        className={className}
        data-copied={isCopied || undefined}
        data-testid={testId}
        disabled={disabled}
        onClick={() => void handleCopy()}
        size={size ?? (iconOnly ? "icon" : "md")}
        title={iconOnly ? label : undefined}
        type="button"
        variant={variant}
      >
        {iconOnly ? <Icon aria-hidden size={16} /> : isCopied ? copiedLabel : label}
      </Button>
      {iconOnly ? (
        <span className="sr-only" role="status">
          {isCopied ? copiedLabel : ""}
        </span>
      ) : null}
      {copyState === "failed" ? (
        <InlineError className="max-w-xs whitespace-normal" testId={testId ? `${testId}-failed` : undefined}>
          {failedMessage}
        </InlineError>
      ) : null}
    </span>
  );
}
