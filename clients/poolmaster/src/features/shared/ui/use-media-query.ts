import { useSyncExternalStore } from "react";

/** Tailwind's `lg` breakpoint: from here a page has room for a wide drawing, such as a whole bracket. */
export const WIDE_SCREEN_QUERY = "(min-width: 1024px)";

/**
 * Whether the window matches a media query now, following it as the window resizes or a phone
 * turns. For a part that draws differently rather than only styles differently by width, such as
 * a bracket drawn whole on a desktop and one region at a time on a phone.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
