import { useRouteError, Link } from 'react-router-dom';

/**
 * Route-level error fallback used by react-router's errorElement.
 * Displays a visible error UI so broken pages can't silently pass E2E tests.
 */
export function RouteErrorFallback() {
  const error = useRouteError() as Error | { statusText?: string; message?: string };
  const message =
    error instanceof Error
      ? error.message
      : (error as { statusText?: string })?.statusText ?? 'An unexpected error occurred.';

  return (
    <div
      role="alert"
      data-testid="route-error-fallback"
      className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center"
    >
      <h1 className="text-2xl font-bold text-destructive mb-2">Something went wrong</h1>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">{message}</p>
      <div className="flex gap-3">
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Reload page
        </button>
        <Link
          to="/dashboard"
          className="px-4 py-2 text-sm font-medium rounded-md border hover:bg-accent"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
