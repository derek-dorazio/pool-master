import * as RadixPopover from "@radix-ui/react-popover";
import { Funnel, Info } from "lucide-react";
import { type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./class-names";
import { InfoPopover } from "./info-popover";

type DataGridFilterPopupProps = {
  /** The popup's body; it mounts each time the popup opens, so a draft starts from the filter in force. */
  children: ReactNode;
  /** Help behind the (i) in the title. */
  help?: ReactNode;
  /** Whether the column is filtered now: its funnel is solid and coloured. */
  isFiltered: boolean;
  /** The column's name, e.g. "Status". */
  label: string;
  onApply: () => void;
  onClear: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** Off while the draft cannot be applied, such as an enum with nothing ticked. */
  canApply: boolean;
  testId: string;
};

/**
 * A grid column's filter: a funnel in the header opens a popup under it that floats over the rows,
 * so nothing moves. Apply sets the filter and closes it, Cancel closes it unchanged, Clear removes
 * the column's filter. Escape is Cancel and Enter is Apply. Focus goes back to the funnel.
 */
/**
 * The popup opens with focus in the input a filter marks `data-autofocus` (the text, number or
 * span box), so the viewer can type at once; a list filter keeps Radix's own first focus.
 */
function focusTheInput(event: Event) {
  const input = event.currentTarget instanceof HTMLElement ? event.currentTarget.querySelector<HTMLElement>("[data-autofocus]") : null;
  if (input) {
    event.preventDefault();
    input.focus();
  }
}

export function DataGridFilterPopup({
  canApply,
  children,
  help,
  isFiltered,
  label,
  onApply,
  onClear,
  onOpenChange,
  open,
  testId,
}: DataGridFilterPopupProps) {
  const applyOnEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.target instanceof HTMLButtonElement) {
      return;
    }
    event.preventDefault();
    if (canApply) {
      onApply();
    }
  };

  return (
    <RadixPopover.Root onOpenChange={onOpenChange} open={open}>
      <RadixPopover.Trigger
        aria-label={isFiltered ? `Filter ${label}, filtered` : `Filter ${label}`}
        className={cn(
          "inline-grid size-5 flex-none place-items-center rounded transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isFiltered || open
            ? "bg-[var(--status-active-surface)] text-selected opacity-100"
            : "opacity-40 group-hover/header:opacity-100",
        )}
        data-testid={testId}
        type="button"
      >
        <Funnel aria-hidden="true" className="size-3" fill={isFiltered ? "currentColor" : "none"} strokeWidth={2} />
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          aria-label={`Filter ${label}`}
          className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover text-sm normal-case tracking-normal text-popover-foreground shadow-lg"
          collisionPadding={16}
          data-testid={`${testId}-popup`}
          onKeyDown={applyOnEnter}
          onOpenAutoFocus={focusTheInput}
          sideOffset={6}
        >
          <div className="grid gap-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-xs font-bold uppercase tracking-label text-muted-foreground">Filter: {label}</span>
              {help ? (
                <InfoPopover icon={<Info aria-hidden="true" className="size-3.5" />} label={`About filtering ${label}`} testId={`${testId}-help`}>
                  {help}
                </InfoPopover>
              ) : null}
            </div>
            {children}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
            <Button data-testid={`${testId}-clear`} onClick={onClear} size="sm" variant="link">
              Clear
            </Button>
            <div className="flex gap-2">
              <RadixPopover.Close asChild>
                <Button data-testid={`${testId}-cancel`} size="sm" variant="secondary">
                  Cancel
                </Button>
              </RadixPopover.Close>
              <Button data-testid={`${testId}-apply`} disabled={!canApply} onClick={onApply} size="sm">
                Apply
              </Button>
            </div>
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
