import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useLocation } from "react-router";
import { cn } from "./class-names";

type DropdownMenuProps = {
  children: ReactNode;
};

/**
 * The one dropdown menu on the site: a button that opens a short list of choices, following the
 * WAI-ARIA menu button pattern. It opens on a click or tap, or Enter, Space or Arrow Down; arrow
 * keys move through the items; and it closes on a choice, a click or tap outside, Escape, a
 * second click on its button, or a move to another page. It never opens or closes on hover.
 * Focus goes back to the button when it closes.
 *
 * Not modal, so a click outside both closes this menu and reaches what was clicked: the page
 * stays usable, and opening a second menu closes the first.
 */
export function DropdownMenu({ children }: DropdownMenuProps) {
  const { pathname } = useLocation();
  // The page the menu was opened on. A page change (the browser's back button, a link
  // elsewhere) closes the menu, because it is only open on that page.
  const [openOnPath, setOpenOnPath] = useState<string | null>(null);
  if (openOnPath !== null && openOnPath !== pathname) {
    // Forget the old page too, so coming back to it does not reopen the menu.
    setOpenOnPath(null);
  }

  return (
    <RadixMenu.Root
      modal={false}
      onOpenChange={(open) => setOpenOnPath(open ? pathname : null)}
      open={openOnPath === pathname}
    >
      {children}
    </RadixMenu.Root>
  );
}

type DropdownMenuTriggerProps = {
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
  testId?: string;
};

/**
 * The button that opens the menu. It is marked open (`data-state="open"`) while the menu shows,
 * for an open look. To open the menu from one of the shared buttons instead, use
 * `DropdownMenuTriggerSlot` with that button as its only child.
 */
export function DropdownMenuTrigger({ "aria-label": ariaLabel, children, className, testId }: DropdownMenuTriggerProps) {
  return (
    <RadixMenu.Trigger
      aria-label={ariaLabel}
      className={cn("cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      data-testid={testId}
    >
      {children}
    </RadixMenu.Trigger>
  );
}

/** Opens the menu from the button passed as its only child, such as a shared `Button`. */
export function DropdownMenuTriggerSlot({ children }: { children: ReactNode }) {
  return <RadixMenu.Trigger asChild>{children}</RadixMenu.Trigger>;
}

const contentWidthClassNames = {
  /** The account menu. */
  md: "w-64",
  /** The league menu: room for a longer league name before it ends in an ellipsis. */
  lg: "w-72",
};

type DropdownMenuContentProps = {
  align?: "start" | "end";
  children: ReactNode;
  testId?: string;
  width: keyof typeof contentWidthClassNames;
};

/**
 * The open menu: a fixed width whatever the items say, so long names end in an ellipsis inside
 * it. On a phone it takes the screen's width less the side margins.
 */
export function DropdownMenuContent({ align = "start", children, testId, width }: DropdownMenuContentProps) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        align={align}
        className={cn(
          "z-50 grid max-w-[calc(100vw-2rem)] gap-0.5 max-sm:w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg",
          contentWidthClassNames[width],
        )}
        collisionPadding={16}
        data-testid={testId}
        sideOffset={8}
      >
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  );
}

/** A small heading over a group of items, such as "Your leagues". */
export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <RadixMenu.Label className="px-2.5 pb-1.5 pt-2 font-display text-xs font-bold uppercase tracking-label text-label">
      {children}
    </RadixMenu.Label>
  );
}

/** A thin line between groups of items. */
export function DropdownMenuSeparator() {
  return <RadixMenu.Separator className="mx-0.5 my-1 h-px bg-border" />;
}

type DropdownMenuItemProps = Omit<ComponentPropsWithoutRef<typeof RadixMenu.Item>, "className"> & {
  /** The entry that is current, such as the league being viewed: tinted, edged and checked. */
  isSelected?: boolean;
};

/**
 * One flat row, at least 44px tall, that tints when the pointer or keyboard is on it. Choosing it
 * runs `onSelect` and closes the menu. For a link, pass `asChild` and the link as the child.
 */
export function DropdownMenuItem({ children, isSelected = false, ...props }: DropdownMenuItemProps) {
  return (
    <RadixMenu.Item
      className={cn(
        "flex min-h-11 min-w-0 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground outline-none transition-colors data-[highlighted]:bg-muted",
        isSelected && "bg-muted shadow-[inset_3px_0_0_var(--surface-selected)]",
      )}
      aria-current={isSelected ? "true" : undefined}
      {...props}
    >
      {children}
    </RadixMenu.Item>
  );
}

/** The check at the right end of the current item. */
export function DropdownMenuCheck() {
  return <Check aria-hidden="true" data-testid="dropdown-menu-check" className="ml-auto h-4 w-4 flex-none text-selected" strokeWidth={3} />;
}

type DropdownMenuItemTextProps = {
  detail?: ReactNode;
  /** A quieter name, such as a league that is not currently active. */
  isMuted?: boolean;
  name: ReactNode;
};

/** A row's text: a name and an optional second line, each ending in an ellipsis when too long. */
export function DropdownMenuItemText({ detail, isMuted = false, name }: DropdownMenuItemTextProps) {
  return (
    <span className="block min-w-0 flex-1">
      <span className={cn("block truncate font-semibold", isMuted && "text-muted-foreground")}>{name}</span>
      {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
    </span>
  );
}
