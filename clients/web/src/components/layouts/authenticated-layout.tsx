import { Link, NavLink, Outlet, Navigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Trophy,
  Compass,
  Settings,
  Menu,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { Logo } from '@/components/ui/logo';
import { usePreferencesStore } from '@/stores/preferences-store';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/leagues', label: 'Leagues', icon: Trophy },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AuthenticatedLayout() {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = usePreferencesStore();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen">
      <aside
        className={cn(
          'hidden border-r bg-card transition-all duration-200 md:flex md:flex-col',
          sidebarCollapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className="flex h-16 items-center border-b px-4">
          <Link to="/dashboard" className="flex items-center gap-2 text-xl font-bold text-primary">
            <Logo size={28} />
            {sidebarCollapsed ? 'UPM' : 'Ultimate Pool Manager'}
          </Link>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b px-4 md:px-6">
          <button
            onClick={toggleSidebar}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-4">
            <NotificationBell />
            <span className="text-sm font-medium">
              {user?.displayName}
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
