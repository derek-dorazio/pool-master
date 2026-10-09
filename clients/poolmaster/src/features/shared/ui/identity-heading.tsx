import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "./button";
import { IconAvatar } from "./icon-avatar";

type IdentityHeadingProps = {
  /** A code people share, such as a league code, shown with a copy button. */
  code?: { label: string; value: string };
  icon: ReactNode;
  /** Short facts after the code, such as counts. */
  meta?: ReactNode;
  name: string;
  testId?: string;
};

/** An entity's identity, once and compactly: icon, name, shareable code and a meta line. */
export function IdentityHeading({ code, icon, meta, name, testId }: IdentityHeadingProps) {
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid={testId}>
      <IconAvatar label={`${name} icon`} size="md">
        {icon}
      </IconAvatar>
      <div className="min-w-0 flex-1">
        <h1
          className="font-display text-2xl font-extrabold text-foreground"
          data-testid={testId ? `${testId}-name` : undefined}
        >
          {name}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {code ? <CodeChip label={code.label} value={code.value} /> : null}
          {meta}
        </div>
      </div>
    </div>
  );
}

function CodeChip({ label, value }: { label: string; value: string }) {
  const [copyState, setCopyState] = useState<"copied" | "failed" | "idle">("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-border pl-2 font-mono text-xs text-foreground">
      {value}
      <Button
        aria-label={`Copy ${label}`}
        className="h-7 w-7 rounded-md"
        onClick={() => void handleCopy()}
        size="icon"
        variant="ghost"
      >
        {copyState === "copied" ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
      </Button>
      <span className="sr-only" role={copyState === "failed" ? "alert" : "status"}>
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : ""}
      </span>
    </span>
  );
}
