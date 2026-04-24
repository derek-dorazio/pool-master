import { Link, useParams } from 'react-router-dom';

export function UserRouteScaffoldPage() {
  const { userId = '' } = useParams<{ userId: string }>();

  return (
    <section className="space-y-6" data-testid="user-route-scaffold-page">
      <div className="rounded-[2rem] border border-border bg-card p-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          User
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          User page coming soon
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          The canonical user route now exists so league-level owner links can converge cleanly, but
          the dedicated user page decomposition has not landed yet.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Requested user id: <span className="font-medium text-foreground">{userId}</span>
        </p>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          This is a truthful scaffold page. Use the current account page for self-service actions
          until the canonical user page is implemented.
        </p>
        <Link
          className="mt-5 inline-flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
          data-testid="user-route-scaffold-link-my-account"
          to="/my-account"
        >
          Open current account page
        </Link>
      </section>
    </section>
  );
}
