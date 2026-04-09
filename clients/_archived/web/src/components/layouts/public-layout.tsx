import { Link, Outlet } from 'react-router-dom';
import { Logo } from '@/components/ui/logo';
import { CookieBanner } from '@/components/cookie-banner';

export function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header data-testid="public-header" className="border-b">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" data-testid="brand-link" className="flex items-center gap-2 text-xl font-bold text-primary">
            <Logo size={28} />
            Ultimate Pool Manager
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              to="/login"
              data-testid="login-link"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Log In
            </Link>
            <Link
              to="/register"
              data-testid="register-link"
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
      <footer data-testid="public-footer" className="border-t py-6">
        <div className="container flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Ultimate Pool Manager
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
