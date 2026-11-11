import { ChevronDown, UserRound } from "lucide-react";
import { Link } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemText,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/features/shared/ui";

type AccountMenuProps = {
  /** The letters in the account button, or null to show a person icon. */
  initials: string | null;
  profilePath: string;
  userName: string;
  onLogout: () => void | Promise<void>;
  isRootAdmin?: boolean;
};

function InitialsCircle({ initials, size }: { initials: string | null; size: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={
        size === "sm"
          ? "flex h-8 w-8 flex-none items-center justify-center rounded-pill border-2 border-label-on-inverse font-display text-xs font-extrabold text-on-inverse"
          : "flex h-9 w-9 flex-none items-center justify-center rounded-pill border-2 border-selected font-display text-sm font-extrabold text-foreground"
      }
    >
      {initials ?? <UserRound className="h-4 w-4" data-testid="account-menu-person-icon" />}
    </span>
  );
}

/**
 * The account button at the header's right end: the user's initials in a circle, the same width
 * whatever their name, opening a menu with their name, Profile, Manage for site admins, and Log out.
 */
export function AccountMenu({ initials, profilePath, userName, onLogout, isRootAdmin = false }: AccountMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${userName}`}
        className="flex flex-none items-center gap-1.5 rounded-pill p-1 text-on-inverse transition hover:bg-on-inverse-subtle data-[state=open]:bg-on-inverse-subtle"
        testId="account-menu-trigger"
      >
        <InitialsCircle initials={initials} size="sm" />
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 opacity-70" strokeWidth={2.5} />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" testId="account-menu-panel" width="md">
        <div className="flex min-w-0 items-center gap-2.5 p-2.5" data-testid="account-menu-identity">
          <InitialsCircle initials={initials} size="md" />
          <DropdownMenuItemText detail="Signed in" name={userName} />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link data-testid="account-menu-profile" to={profilePath}>
            <DropdownMenuItemText name="Profile" />
          </Link>
        </DropdownMenuItem>
        {isRootAdmin ? (
          <DropdownMenuItem asChild>
            <Link data-testid="account-menu-manage" to="/manage">
              <DropdownMenuItemText name="Manage" />
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="account-menu-logout" onSelect={() => void onLogout()}>
          <DropdownMenuItemText name="Log out" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
