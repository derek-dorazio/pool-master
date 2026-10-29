import type { ReactNode } from "react";
import { cn } from "./class-names";
import { Tile } from "./tile";

export type NumberedStep = {
  title: string;
  body: string;
  /** A picture across the top of the step's tile. */
  picture?: ReactNode;
};

/**
 * Steps in order, each in its own tile under a gold numeral. `className` sets the list's layout
 * (a phone scroller, say); the default is a stack that turns into three columns on wide screens.
 */
export function NumberedSteps({
  className,
  steps,
  testId,
}: {
  className?: string;
  steps: readonly NumberedStep[];
  testId?: string;
}) {
  return (
    <ol className={cn("grid gap-4 md:grid-cols-3", className)} data-testid={testId}>
      {steps.map((step, index) => (
        <li className="list-none" key={step.title}>
          <Tile className="h-full" padding="none" radius="md">
            {step.picture}
            <div className="p-4">
              <p className="font-display text-2xl font-bold text-primary">{index + 1}</p>
              <h3 className="title-card text-foreground">{step.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
            </div>
          </Tile>
        </li>
      ))}
    </ol>
  );
}
