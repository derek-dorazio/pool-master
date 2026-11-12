import { Check } from "lucide-react";
import { cn } from "./class-names";
import { Text } from "./text";

/** What the track sits on: a normal card, or a navy panel. */
export type StageTrackSurface = "default" | "inverse";

type StageState = "done" | "current" | "upcoming";

/** An upcoming stage's outlined circle and the line up to it, in the surface's muted colour. */
const UPCOMING_TONE: Record<StageTrackSurface, string> = {
  default: "text-muted-foreground",
  inverse: "text-on-inverse-muted",
};

const LINE_TONE: Record<StageTrackSurface, string> = {
  default: "bg-border",
  inverse: "bg-inverse-border",
};

const STATE_WORDS: Record<StageState, string> = {
  done: "done",
  current: "current stage",
  upcoming: "to come",
};

/**
 * Where something is in a fixed run of stages, as a numbered stepper: a circle per stage with its
 * label under it, joined by a line. A done stage is a green circle with a check and the line up
 * to it is green; the current stage is a filled gold circle with its number and a bold label;
 * one to come is an outlined circle with its number. A contest's lifecycle on Manage contest,
 * an event's on root admin. Works on a card and on a navy panel, in light and dark.
 */
export function StageTrack({
  currentIndex,
  stages,
  surface = "default",
  testId,
}: {
  /** The stage things are at, counted from 0. */
  currentIndex: number;
  stages: readonly string[];
  surface?: StageTrackSurface;
  testId?: string;
}) {
  return (
    <ol aria-label="Stages" className="flex items-start" data-testid={testId}>
      {stages.map((stage, index) => {
        const state: StageState = index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
        return (
          <li
            aria-current={state === "current" ? "step" : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center"
            data-state={state}
            data-testid={testId ? `${testId}-${String(index)}` : undefined}
            key={stage}
          >
            {index > 0 ? (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[calc(-50%+1rem)] right-[calc(50%+1rem)] top-3 h-0.5 rounded-full",
                  index <= currentIndex ? "bg-done" : LINE_TONE[surface],
                )}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                "grid h-6 w-6 place-items-center rounded-full font-display text-xs font-bold tabular-nums",
                state === "done" && "bg-done text-done-foreground",
                state === "current" && "bg-primary text-primary-foreground",
                state === "upcoming" && cn("border-2 border-current", UPCOMING_TONE[surface]),
              )}
            >
              {state === "done" ? <Check size={14} strokeWidth={3} /> : index + 1}
            </span>
            <Text
              className="max-w-full truncate"
              size="xs"
              tone={state === "current"
                ? surface === "inverse" ? "onInverse" : "default"
                : surface === "inverse" ? "onInverseLabel" : "muted"}
              weight={state === "current" ? "bold" : "medium"}
            >
              {stage}
              <span className="sr-only">{`, ${STATE_WORDS[state]}`}</span>
            </Text>
          </li>
        );
      })}
    </ol>
  );
}
