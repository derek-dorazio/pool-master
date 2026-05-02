import { LinkButton, ListCard } from '@/features/shared/ui';

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
      <section className="grid gap-4 xl:grid-cols-3">
        {SYNC_CONFIG_DESTINATIONS.map((destination) => (
          <ListCard
            actions={(
              <LinkButton
                data-testid={`root-admin-sync-config-link-${destination.key}`}
                to={destination.to}
                variant="secondary"
              >
                Open {destination.title}
              </LinkButton>
            )}
            description={destination.description}
            key={destination.key}
            title={destination.title}
          />
        ))}
      </section>
    </section>
  );
}
