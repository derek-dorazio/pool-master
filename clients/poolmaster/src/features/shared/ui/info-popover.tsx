import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "./class-names";
import { Tile } from "./tile";

const CALLOUT_WIDTH = 288;
const SCREEN_GUTTER = 16;

/**
 * A small icon button that keeps secondary facts out of the way: hovering it with a mouse, or
 * tapping or pressing it, shows them in a callout. Leaving it, tapping it again, tapping elsewhere or Escape
 * hides them. Tap is the phone's way in, since a phone has no hover.
 */
export function InfoPopover({
  children,
  className,
  icon,
  label,
  testId,
}: {
  /** The callout's content. */
  children: ReactNode;
  className?: string;
  /** What the button shows. */
  icon: ReactNode;
  /** The button's accessible name, which also says what the callout is about. */
  label: string;
  testId: string;
}) {
  // Hover opens it while the mouse is over it; a tap or click pins it open until tapped again.
  // Only a mouse hovers: a phone's tap also fires enter, which would fight the tap's toggle.
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  // How far left the callout shifts so it ends inside the screen when its icon sits near the
  // right edge, as it does beside a long title on a phone.
  const [shiftLeft, setShiftLeft] = useState(0);
  const isOpen = isHovered || isPinned;
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const placeCallout = () => {
    const left = rootRef.current?.getBoundingClientRect().left ?? 0;
    const width = Math.min(CALLOUT_WIDTH, window.innerWidth - 2 * SCREEN_GUTTER);
    setShiftLeft(Math.max(0, left + width - (window.innerWidth - SCREEN_GUTTER)));
  };
  const close = () => {
    setIsHovered(false);
    setIsPinned(false);
  };

  // A tap elsewhere closes a pinned callout. Blur alone misses it: Safari does not focus a
  // tapped button, so it never blurs.
  useEffect(() => {
    if (!isPinned) {
      return undefined;
    }
    const closeOnOutsideTap = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsPinned(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideTap);
    return () => document.removeEventListener("pointerdown", closeOnOutsideTap);
  }, [isPinned]);

  return (
    <span className={cn("relative inline-flex", className)} ref={rootRef}>
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        aria-label={label}
        className="inline-flex size-9 items-center justify-center rounded-full transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={testId}
        onBlur={close}
        onClick={() => {
          placeCallout();
          setIsPinned((pinned) => !pinned);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            close();
          }
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") {
            placeCallout();
            setIsHovered(true);
          }
        }}
        onPointerLeave={() => setIsHovered(false)}
        type="button"
      >
        {icon}
      </button>
      {isOpen ? (
        <Tile
          className="absolute top-full z-40 mt-2 shadow-xl"
          data-testid={`${testId}-callout`}
          id={panelId}
          padding="sm"
          radius="lg"
          role="region"
          style={{ left: -shiftLeft, width: `min(${CALLOUT_WIDTH}px, calc(100vw - ${2 * SCREEN_GUTTER}px))` }}
          aria-label={label}
        >
          {children}
        </Tile>
      ) : null}
    </span>
  );
}
