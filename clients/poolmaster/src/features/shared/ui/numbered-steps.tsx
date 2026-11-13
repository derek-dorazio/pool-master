import type { ReactNode } from "react";
import { cn } from "./class-names";
import { Heading } from "./heading";
import { Tile } from "./tile";

export type NumberedStep = {
  title: string;
  /** What the step means; left out where the titles say enough, such as the sign-in page. */
  body?: string;
  /** A picture across the top of the step's tile. */
  picture?: ReactNode;
};

/** `compact` sets each tile tighter, for three steps side by side beside a form or on a phone. */
export type NumberedStepsDensity = "comfortable" | "compact";

/**
 * Steps in order, each in its own tile under a gold numeral. `className` sets the list's layout
 * (a phone scroller, say); the default is a stack that turns into three columns on wide screens.
 */
export function NumberedSteps({
  className,
  density = "comfortable",
  steps,
  testId,
}: {
  className?: string;
  density?: NumberedStepsDensity;
  steps: readonly NumberedStep[];
  testId?: string;
}) {
  const compact = density === "compact";
  return (
    <ol className={cn("grid gap-4 md:grid-cols-3", className)} data-testid={testId}>
      {steps.map((step, index) => (
        <li className="list-none" key={step.title}>
          <Tile className="h-full" padding="none">
            {step.picture}
            <div className={compact ? "p-2 sm:p-3" : "p-4"}>
              <p className={cn("font-display font-bold text-primary", compact ? "text-lg" : "text-2xl")}>{index + 1}</p>
              <Heading level={3} size={compact ? "sm" : undefined} variant="card">{step.title}</Heading>
              {step.body ? <p className="mt-1 text-sm text-muted-foreground">{step.body}</p> : null}
            </div>
          </Tile>
        </li>
      ))}
    </ol>
  );
}
