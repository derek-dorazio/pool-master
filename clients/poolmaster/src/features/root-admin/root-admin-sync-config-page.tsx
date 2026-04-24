import { Link } from 'react-router-dom';

const SYNC_CONFIG_DESTINATIONS = [
  {
    key: 'poll-intervals',
    title: 'Poll Intervals',
    description:
      'Client-facing refresh guidance stored durably in runtime config for standings, drafts, notifications, and default polling.',
    to: '/manage/sync-config/poll-intervals',
  },
  {
    key: 'ingestion-schedule',
    title: 'Global Ingestion Schedule',
    description:
      'Default cadence and lifecycle windows that automated ingestion uses across sports before per-sport overrides apply.',
    to: '/manage/sync-config/ingestion-schedule',
  },
  {
    key: 'sport-overrides',
    title: 'Sport Ingestion Overrides',
    description:
      'Enable or disable automated feed policies per sport without changing the global schedule for every other sport.',
    to: '/manage/sync-config/sport-overrides',
  },
] as const;

export function RootAdminSyncConfigPage() {
  return (
    <section className="space-y-6" data-testid="root-admin-sync-config-page">
      <div className="rounded-[2rem] border border-border bg-card p-6">
        <Link
          className="text-sm font-medium text-primary transition hover:opacity-80"
          to="/manage"
        >
          Back to Manage
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          Sync Configuration
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          Durable platform settings for client polling and automated ingestion
          behavior now live in focused edit pages. Choose the configuration area
          you want to review or change.
        </p>
      </div>

      <section className="grid gap-4 xl:grid-cols-3">
        {SYNC_CONFIG_DESTINATIONS.map((destination) => (
          <article
            className="rounded-[2rem] border border-border bg-card p-6"
            key={destination.key}
          >
            <h2 className="text-xl font-semibold text-foreground">
              {destination.title}
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {destination.description}
            </p>
            <Link
              className="mt-5 inline-flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
              data-testid={`root-admin-sync-config-link-${destination.key}`}
              to={destination.to}
            >
              Open {destination.title}
            </Link>
          </article>
        ))}
      </section>
    </section>
  );
}
