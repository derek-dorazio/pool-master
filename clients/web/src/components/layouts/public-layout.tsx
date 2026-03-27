import { Link, Outlet } from 'react-router-dom';
import { CookieBanner } from '@/components/cookie-banner';

export function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="text-xl font-bold text-primary">
            PoolMaster
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              to="/login"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Log In
            </Link>
            <Link
              to="/register"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t py-6">
        <div className="container flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} PoolMaster
          </p>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link to="/cookie-policy" className="hover:text-foreground">Cookies</Link>
            <Link to="/responsible-gaming" className="hover:text-foreground">Responsible Gaming</Link>
          </nav>
        </div>
      </footer>
      <CookieBanner />
    </div>
  );
}
