import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** How far the faded edge reaches into the row: a selected tab is scrolled clear of it. */
const FADE_PX = 48;

// Each fade is drawn on a phone only, and only on a side with more tabs beyond it.
const FADE_CLASS_NAMES = {
  after: "max-sm:[mask-image:linear-gradient(to_right,black_calc(100%_-_3rem),transparent)]",
  before: "max-sm:[mask-image:linear-gradient(to_left,black_calc(100%_-_3rem),transparent)]",
  both: "max-sm:[mask-image:linear-gradient(to_right,transparent,black_3rem,black_calc(100%_-_3rem),transparent)]",
} as const;

type Overflow = "none" | keyof typeof FADE_CLASS_NAMES;

const SELECTED_SELECTOR = '[aria-current="page"], [role="tab"][data-state="active"]';

function readOverflow(row: HTMLElement): Overflow {
  const hasBefore = row.scrollLeft > 1;
  const hasAfter = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
  if (hasBefore && hasAfter) return "both";
  if (hasBefore) return "before";
  return hasAfter ? "after" : "none";
}

/**
 * Brings the row's selected item fully into view, clear of the faded edges. Only the row's own
 * `scrollLeft` moves, so the page never scrolls vertically, and it jumps rather than animates.
 */
function revealSelected(row: HTMLElement) {
  const selected = row.querySelector<HTMLElement>(SELECTED_SELECTOR);
  if (!selected) return;
  const left = selected.offsetLeft;
  const right = left + selected.offsetWidth;
  if (right > row.scrollLeft + row.clientWidth - FADE_PX) {
    row.scrollLeft = right - row.clientWidth + FADE_PX;
  } else if (left < row.scrollLeft + FADE_PX) {
    row.scrollLeft = left - FADE_PX;
  }
}

/**
 * A row of tabs or links that scrolls sideways on a phone. On open, and whenever the selected
 * item changes (a link's `aria-current` or a Radix tab's `data-state`) or the items change size,
 * the selected item is scrolled into view; the edges fade only where more items sit beyond them. The row must be
 * `relative`, so its items' offsets are measured from it.
 */
export function useScrollRow<T extends HTMLElement>(): { fadeClassName: string; ref: RefObject<T | null> } {
  const ref = useRef<T>(null);
  const [overflow, setOverflow] = useState<Overflow>("none");

  const update = useCallback(() => {
    if (ref.current) setOverflow(readOverflow(ref.current));
  }, []);

  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const revealAndUpdate = () => {
      revealSelected(row);
      update();
    };
    revealAndUpdate();

    // A label or font that changes an item's width moves the selected item, so watch every item.
    const resizeObserver = new ResizeObserver(revealAndUpdate);
    const observeSizes = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(row);
      for (const item of Array.from(row.children)) resizeObserver.observe(item);
    };
    observeSizes();

    const mutationObserver = new MutationObserver(() => {
      observeSizes();
      revealAndUpdate();
    });
    mutationObserver.observe(row, { attributeFilter: ["aria-current", "data-state"], childList: true, subtree: true });
    row.addEventListener("scroll", update, { passive: true });
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      row.removeEventListener("scroll", update);
    };
  }, [update]);

  return { fadeClassName: overflow === "none" ? "" : FADE_CLASS_NAMES[overflow], ref };
}
