import type { ReactNode } from "react";
import { cn } from "./class-names";
import { Heading } from "./heading";
import { Tile } from "./tile";

export type StripStep = {
  title: string;
  /** A small picture at the step's start, drawn to fill a 16:10 frame. */
  picture?: ReactNode;
};

/**
 * Steps in order as one slim strip (#1701): each a short tile with a small picture, its gold
 * numeral and its title, three across from the small breakpoint and stacked on a phone. The
 * slim form of `NumberedSteps`, for a page whose steps are a reminder rather than its subject.
 */
export function StepStrip({ className, steps, testId }: { className?: string; steps: readonly StripStep[]; testId?: string }) {
  return (
    <ol className={cn("grid gap-2 sm:grid-cols-3", className)} data-testid={testId}>
      {steps.map((step, index) => (
        <li className="list-none" key={step.title}>
          <Tile className="flex h-full items-center gap-3 overflow-hidden p-1.5 pr-3" padding="none" radius="sm">
            {step.picture ? <span className="w-14 shrink-0 overflow-hidden rounded-md">{step.picture}</span> : null}
            <span className="font-display text-lg font-bold text-primary">{index + 1}</span>
            <Heading className="min-w-0" level={3} size="sm" variant="card">{step.title}</Heading>
          </Tile>
        </li>
      ))}
    </ol>
  );
}
