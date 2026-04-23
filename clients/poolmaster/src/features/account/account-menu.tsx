import { useState } from 'react';
import { Link } from 'react-router-dom';

type AccountMenuProps = {
  userName: string;
  onLogout: () => void | Promise<void>;
  isRootAdmin?: boolean;
};

export function AccountMenu({ userName, onLogout, isRootAdmin = false }: AccountMenuProps) {
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
        <div
          className="absolute right-0 z-40 mt-3 w-72 rounded-[1.5rem] border border-border bg-card p-3 shadow-xl"
          data-testid="account-menu-panel"
        >
          <div className="rounded-[1.25rem] border border-border bg-background px-4 py-3">
            <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Signed in as</div>
            <div className="mt-2 text-base font-semibold text-foreground">{userName}</div>
          </div>

          <nav aria-label="User menu" className="mt-3 space-y-2">
            {isRootAdmin ? (
              <Link
                className="block rounded-[1.25rem] border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
                data-testid="account-menu-manage"
                onClick={() => setIsOpen(false)}
                to="/manage"
              >
                Manage
              </Link>
            ) : null}
            <Link
              className="block rounded-[1.25rem] border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
              data-testid="account-menu-profile"
              onClick={() => setIsOpen(false)}
              to="/my-account"
            >
              Profile
            </Link>
            <button
              className="block w-full rounded-[1.25rem] bg-primary px-4 py-3 text-left text-sm font-medium text-primary-foreground transition hover:opacity-95"
              data-testid="account-menu-logout"
              onClick={() => {
                setIsOpen(false);
                void onLogout();
              }}
              type="button"
            >
              Log out
            </button>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
