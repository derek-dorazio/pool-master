import { useId, type ReactNode } from "react";
import { HelpTip } from "./help-tip";
import { Heading } from "./heading";

/**
 * One part of a setup form inside its card: a title, with its step number in a filled circle when
 * the form is a sequence (1 Event, 2 Format…), and how it works behind a (?) rather than a
 * sentence under the title. Sections after the first are ruled off from the one above.
 */
export function FormSection({
  children,
  help,
  step,
  testId,
  title,
}: {
  children: ReactNode;
  /** How the section works, in one to three sentences, behind the title's (?). */
  help?: ReactNode;
  /** The step's number, for a form filled in order; left out, the title stands alone. */
  step?: number;
  testId?: string;
  title: string;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3 border-t border-border pt-5 first:border-t-0 first:pt-0"
      data-testid={testId}
    >
      <div className="flex min-h-11 items-center gap-2">
        {step !== undefined ? (
          <span
            aria-hidden
            className="grid h-6 w-6 flex-none place-items-center rounded-full bg-primary font-display text-xs font-bold text-primary-foreground"
            data-testid={testId ? `${testId}-step` : undefined}
          >
            {step}
          </span>
        ) : null}
        <Heading id={titleId} level={3} size="base" tone="inherit" variant="card">
          {step !== undefined ? <span className="sr-only">{`Step ${String(step)}: `}</span> : null}
          {title}
        </Heading>
        {help ? (
          <HelpTip className="-my-2 shrink-0" label={`About ${title}`} testId={testId ? `${testId}-help` : "form-section-help"}>
            {help}
          </HelpTip>
        ) : null}
      </div>
      {children}
    </section>
  );
}
