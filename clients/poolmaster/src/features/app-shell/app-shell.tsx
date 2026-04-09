import { Link, Outlet, useLocation } from 'react-router-dom';
import { routeMap } from '@/routes/route-map';

function roleLabel(role: string) {
  return role.replace('_', ' ');
}

export function AppShell() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              PoolMaster
            </span>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">Single role-based web app</h1>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Members, commissioners, and root admins will all operate inside one app shell.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
            Current route: <span className="font-medium text-foreground">{location.pathname}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-3xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Route Map
            </h2>
            <nav className="mt-4 space-y-3">
              {routeMap.map((item) => {
                const active = item.path === location.pathname;
                return (
                  <Link
                    key={item.path}
                    className={`block rounded-2xl border px-4 py-3 transition ${
                      active
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/40 hover:bg-muted/40'
                    }`}
                    to={item.path}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{item.label}</span>
                      <span className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                        {roleLabel(item.role)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
