import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { Input } from "./form-field";

type CopyFieldProps = {
  "aria-label": string;
  disabled?: boolean;
  onCopy?: () => void;
  value: string;
};

export function CopyField({
  "aria-label": ariaLabel,
  disabled = false,
  onCopy,
  value,
}: CopyFieldProps) {
  const [copyState, setCopyState] = useState<"copied" | "idle" | "failed">(
    "idle",
  );
  const canCopy = Boolean(value) && !disabled;

  async function handleCopy() {
    if (!canCopy) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      onCopy?.();
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="flex gap-3">
      <Input aria-label={ariaLabel} readOnly value={value} />
      <Button
        aria-label={`Copy ${ariaLabel}`}
        disabled={!canCopy}
        onClick={() => void handleCopy()}
        size="icon"
        type="button"
        variant="icon"
      >
        {copyState === "copied" ? (
          <Check aria-hidden size={18} />
        ) : (
          <Copy aria-hidden size={18} />
        )}
      </Button>
      <span
        className="sr-only"
        role={copyState === "failed" ? "alert" : "status"}
      >
        {copyState === "copied"
          ? "Copied"
          : copyState === "failed"
            ? "Copy failed"
            : ""}
      </span>
    </div>
  );
}
