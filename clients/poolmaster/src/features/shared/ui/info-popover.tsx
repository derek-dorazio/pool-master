import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "./class-names";
import { HOVER_CLOSE_GRACE_MS } from "./popover-timing";
import { Tile } from "./tile";

const CALLOUT_WIDTH = 288;
const SCREEN_GUTTER = 16;

/**
 * A small icon button that keeps secondary facts out of the way: hovering it with a mouse, or
 * tapping or pressing it, shows them in a callout. Leaving it, tapping it again, tapping elsewhere or Escape
 * hides them. Tap is the phone's way in, since a phone has no hover. The pointer can move from
 * the icon into the callout, to reach a link there, without it closing: the space between them is
 * part of the callout, and the callout waits a moment after the mouse leaves before it closes. The callout's content
 * mounts only while it is open, so content that reads data reads it when first opened.
 */
export function InfoPopover({
  children,
  className,
  hoverDelayMs = 0,
  icon,
  label,
  look = "card",
  onHoverStart,
  padding = "sm",
  testId,
}: {
  /** The callout's content. */
  children: ReactNode;
  className?: string;
  /** How long a mouse rests on the icon before the callout shows, so a pointer passing down a list does not flash every row. */
  hoverDelayMs?: number;
  /** What the button shows. */
  icon: ReactNode;
  /** The button's accessible name, which also says what the callout is about. */
  label: string;
  /** `card` is the light peek card; `tooltip` is the small navy tooltip a HelpTip shows. */
  look?: "card" | "tooltip";
  /** Called as soon as a mouse reaches the icon, before any delay: the moment to start reading what the callout shows. */
  onHoverStart?: () => void;
  /** The callout's padding: `none` for content that draws its own sections. */
  padding?: "none" | "sm";
  testId: string;
}) {
  // Hover opens it while the mouse is over it; a tap or click pins it open until tapped again.
  // Only a mouse hovers: a phone's tap also fires enter, which would fight the tap's toggle.
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  // Where the callout sits on screen. It is fixed to the viewport, below its icon, so a card
  // that clips its own overflow (a SectionCard's rounded corners) cannot cut it off; it shifts
  // left to end inside the screen when its icon sits near the right edge, as it does beside a
  // long title on a phone.
  const [place, setPlace] = useState({ left: 0, top: 0 });
  const isOpen = isHovered || isPinned;
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHover = () => {
    for (const timer of [hoverTimer, closeTimer]) {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    }
  };
  useEffect(() => cancelHover, []);
  const placeCallout = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const width = Math.min(CALLOUT_WIDTH, window.innerWidth - 2 * SCREEN_GUTTER);
    setPlace({
      left: left - Math.max(0, left + width - (window.innerWidth - SCREEN_GUTTER)),
      top: rect?.bottom ?? 0,
    });
  };
  const close = () => {
    cancelHover();
    setIsHovered(false);
    setIsPinned(false);
  };

  // A fixed callout stays put while the page moves, so it follows its icon on scroll and resize.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    window.addEventListener("scroll", placeCallout, true);
    window.addEventListener("resize", placeCallout);
    return () => {
      window.removeEventListener("scroll", placeCallout, true);
      window.removeEventListener("resize", placeCallout);
    };
  }, [isOpen]);

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
    <span
      className={cn("relative inline-flex", className)}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") {
          return;
        }
        cancelHover();
        if (isHovered) {
          // Back from a short trip outside: the callout never closed, so it does not wait again.
          return;
        }
        onHoverStart?.();
        placeCallout();
        if (hoverDelayMs > 0) {
          hoverTimer.current = setTimeout(() => setIsHovered(true), hoverDelayMs);
        } else {
          setIsHovered(true);
        }
      }}
      onPointerLeave={() => {
        cancelHover();
        closeTimer.current = setTimeout(() => setIsHovered(false), HOVER_CLOSE_GRACE_MS);
      }}
      ref={rootRef}
    >
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        aria-label={label}
        className="inline-flex size-9 items-center justify-center rounded-full transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={testId}
        onBlur={(event) => {
          // Focus moving into the callout, to its link say, keeps it open.
          if (!rootRef.current?.contains(event.relatedTarget)) {
            close();
          }
        }}
        onClick={() => {
          placeCallout();
          setIsPinned((pinned) => !pinned);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            close();
          }
        }}
        type="button"
      >
        {icon}
      </button>
      {isOpen ? (
        // The gap above the card is padding on this wrapper, not margin, so it belongs to the
        // callout's hit area and a mouse crossing it never leaves.
        <span
          className="fixed z-40 block pt-2"
          data-testid={`${testId}-callout`}
          id={panelId}
          style={{ left: place.left, top: place.top, width: `min(${CALLOUT_WIDTH}px, calc(100vw - ${2 * SCREEN_GUTTER}px))` }}
        >
          <Tile
            className={cn("shadow-xl", padding === "none" && "overflow-hidden", look === "tooltip" && "rounded-lg")}
            padding={padding}
            radius="lg"
            variant={look === "tooltip" ? "inverse" : "default"}
          >
            {children}
          </Tile>
        </span>
      ) : null}
    </span>
  );
}
