import type { KeyboardEvent } from "react";

type RadioChoice = { disabled?: boolean; value: string };

const STEPS: Partial<Record<string, number | "first" | "last">> = {
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -1,
  End: "last",
  Home: "first",
};

/**
 * The radio a hand-drawn radio group (`SegmentedControl`, `ViewFilter`) lets Tab reach: the
 * checked one, or the first that can be picked when none is checked. The rest are skipped, so the
 * group is one Tab stop, as a native radio group is.
 */
export function radioTabStop(choices: readonly RadioChoice[], value: string) {
  const checked = choices.find((choice) => choice.value === value && !choice.disabled);
  return (checked ?? choices.find((choice) => !choice.disabled))?.value ?? null;
}

/**
 * The arrow keys of a radio group, as the ARIA radio group pattern has them: Left/Up and
 * Right/Down move to the previous or next choice and pick it, wrapping at the ends; Home and End
 * pick the first and last. Disabled choices are passed over. Put it on each radio's `onKeyDown`;
 * focus follows the choice to the radio drawn for it in the same group.
 */
export function handleRadioGroupKeyDown(
  event: KeyboardEvent<HTMLElement>,
  choices: readonly RadioChoice[],
  value: string,
  onChange: (value: string) => void,
) {
  const step = STEPS[event.key];
  const enabled = choices.filter((choice) => !choice.disabled);
  if (step === undefined || enabled.length === 0) {
    return;
  }
  event.preventDefault();
  const last = enabled.length - 1;
  const current = enabled.findIndex((choice) => choice.value === value);
  // With nothing checked yet, the next choice is the first and the previous the last.
  const nextIndex = step === "first" ? 0
    : step === "last" ? last
      : current < 0 ? (step > 0 ? 0 : last)
        : (current + step + enabled.length) % enabled.length;
  const next = enabled.at(nextIndex);
  if (!next) {
    return;
  }
  if (next.value !== value) {
    onChange(next.value);
  }
  const group = event.currentTarget.closest('[role="radiogroup"]');
  const radios = group ? Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')) : [];
  radios[choices.indexOf(next)]?.focus();
}
