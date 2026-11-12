import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { InfoPopover } from "./info-popover";

/**
 * Help (more-info pattern 1): "how does this work?" answered in place. A (?) right after a page
 * title, section title or form label opens a small navy tooltip: one to three plain sentences
 * and at most one link on, such as How to Play. Mouse hover opens it, and so do Enter or Space on
 * its focused button and a tap on a phone; Escape or a tap elsewhere closes it. It holds what used to be a grey sentence
 * under a title; facts about one thing are a `DetailsPeek`, and anything urgent is a `Notice`.
 */
export function HelpTip({
  children,
  className,
  label,
  learnMore,
  surface = "default",
  testId,
}: {
  /** One to three sentences, plain text. */
  children: ReactNode;
  className?: string;
  /** What it explains, for a screen reader: "About the points race". */
  label: string;
  /** The one link on, if any. */
  learnMore?: { label: string; to: string };
  /** What the (?) sits on: a normal card, or a navy panel, where it takes the panel's muted text. */
  surface?: "default" | "inverse";
  testId: string;
}) {
  return (
    <InfoPopover
      className={className}
      icon={<CircleHelp aria-hidden className={surface === "inverse" ? "text-on-inverse-muted" : "text-muted-foreground"} size={16} />}
      label={label}
      look="tooltip"
      testId={testId}
    >
      <span className="block space-y-2 text-left text-sm font-normal normal-case not-italic leading-snug tracking-normal">
        <span className="block">{children}</span>
        {learnMore ? (
          <Link className="block font-semibold text-gold-300 hover:underline" data-testid={`${testId}-link`} to={learnMore.to}>
            {learnMore.label} →
          </Link>
        ) : null}
      </span>
    </InfoPopover>
  );
}
