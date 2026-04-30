import { useState } from "react";
import { ActionList, ActionTile, Tile } from "@/features/shared/ui";

type AccountMenuProps = {
  profilePath: string;
  userName: string;
  onLogout: () => void | Promise<void>;
  isRootAdmin?: boolean;
};

export function AccountMenu({
  profilePath,
  userName,
  onLogout,
  isRootAdmin = false,
}: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-card"
        data-testid="account-menu-trigger"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        {userName}
      </button>

      {isOpen ? (
        <Tile
          className="absolute right-0 z-40 mt-3 w-72 shadow-xl"
          data-testid="account-menu-panel"
          padding="sm"
          radius="lg"
        >
          <div className="rounded-[1.25rem] border border-border bg-background px-4 py-3">
            <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
              Signed in as
            </div>
            <div className="mt-2 text-base font-semibold text-foreground">
              {userName}
            </div>
          </div>

          <nav aria-label="User menu" className="mt-3">
            <ActionList>
              {isRootAdmin ? (
                <ActionTile
                  data-testid="account-menu-manage"
                  label="Manage"
                  onClick={() => setIsOpen(false)}
                  to="/manage"
                  tone="primary"
                />
              ) : null}
              <ActionTile
                data-testid="account-menu-profile"
                label="Profile"
                onClick={() => setIsOpen(false)}
                to={profilePath}
                tone="primary"
              />
              <ActionTile
                data-testid="account-menu-logout"
                label="Log out"
                onClick={() => {
                  setIsOpen(false);
                  void onLogout();
                }}
                tone="primary"
              />
            </ActionList>
          </nav>
        </Tile>
      ) : null}
    </div>
  );
}
