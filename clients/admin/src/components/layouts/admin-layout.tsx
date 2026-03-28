import { Navigate, NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Users,
  Trophy,
  Database,
  Flag,
  Activity,
  FileText,
  Megaphone,
  Workflow,
  Settings2,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminAuthStore } from '@/stores/admin-auth-store';
import { useState } from 'react';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tenants', label: 'Tenants', icon: Building2 },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/contests', label: 'Contests', icon: Trophy },
  { to: '/providers', label: 'Providers', icon: Database },
  { to: '/flags', label: 'Flags', icon: Flag },
  { to: '/health', label: 'Health', icon: Activity },
  { to: '/audit', label: 'Audit', icon: FileText },
  { to: '/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/migrations', label: 'Migrations', icon: Workflow },
  { to: '/config', label: 'Config', icon: Settings2 },
];

type HealthStatus = 'green' | 'yellow' | 'red';

function HealthDot({ status }: { status: HealthStatus }) {
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full',
        status === 'green' && 'bg-green-500',
        status === 'yellow' && 'bg-yellow-500',
        status === 'red' && 'bg-red-500',
      )}
    />
  );
}

export function AdminLayout() {
  const { adminUser, isAuthenticated, isLoading, clearAdminUser } = useAdminAuthStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const healthStatus: HealthStatus = 'green';

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-[240px] shrink-0 flex-col border-r bg-muted/40">
        <div className="flex h-14 items-center border-b px-4">
          <span className="text-lg font-semibold text-primary">PM Admin</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Impersonation banner */}
        <div
          className="hidden bg-yellow-400 px-4 py-1.5 text-center text-sm font-medium text-yellow-900"
          id="impersonation-banner"
        >
          Impersonating user — actions are logged
        </div>

        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">PoolMaster Admin</span>
            <HealthDot status={healthStatus} />
          </div>
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent"
            >
              {adminUser?.name ?? 'Admin'}
              <ChevronDown className="h-4 w-4" />
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border bg-popover p-1 shadow-md">
                <button
                  onClick={() => {
                    clearAdminUser();
                    setDropdownOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
