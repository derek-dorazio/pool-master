import type { FocusEvent, KeyboardEvent } from "react";

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

function radiosIn(group: HTMLElement) {
  return Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
}

/**
 * The arrow keys of a radio group, as the ARIA radio group pattern has them: Left/Up and
 * Right/Down move to the previous or next choice and pick it, wrapping at the ends; Home and End
 * pick the first and last. Disabled choices are passed over, and focus follows the choice to its
 * radio.
 */
function handleRadioGroupKeyDown(
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
  radiosIn(event.currentTarget)[choices.indexOf(next)]?.focus();
}

/**
 * With nothing checked, Shift+Tab into the group lands on its last choice, as a native radio
 * group's does; Tab still lands on the first, the group's one Tab stop.
 */
function handleRadioGroupFocus(event: FocusEvent<HTMLElement>, choices: readonly RadioChoice[], value: string) {
  const group = event.currentTarget;
  const from = event.relatedTarget;
  const enteredBackwards = from instanceof Node
    && !group.contains(from)
    && (group.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  if (!enteredBackwards || choices.some((choice) => choice.value === value && !choice.disabled)) {
    return;
  }
  const lastEnabled = choices.filter((choice) => !choice.disabled).at(-1);
  if (lastEnabled) {
    radiosIn(group)[choices.indexOf(lastEnabled)]?.focus();
  }
}

/**
 * The keyboard of a hand-drawn radio group (`SegmentedControl`, `ViewFilter`): spread `group` on
 * the element with `role="radiogroup"` and give each radio `tabIndex={tabIndexFor(value)}`. The
 * group owns the arrow keys in one handler, so it takes `tabIndex` -1: focusable from code only,
 * never a Tab stop of its own.
 */
export function radioGroupKeyboard(choices: readonly RadioChoice[], value: string, onChange: (value: string) => void) {
  const tabStop = radioTabStop(choices, value);
  return {
    group: {
      onFocus: (event: FocusEvent<HTMLElement>) => handleRadioGroupFocus(event, choices, value),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => handleRadioGroupKeyDown(event, choices, value, onChange),
      tabIndex: -1,
    },
    tabIndexFor: (choiceValue: string) => (choiceValue === tabStop ? 0 : -1),
  };
}
