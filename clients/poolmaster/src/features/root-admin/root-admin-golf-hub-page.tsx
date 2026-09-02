import { LinkButton, ListCard } from '@/features/shared/ui';

/**
 * plans/124 §6.3 — /manage/golf golf hub. Mirrors the root-admin-sync-config-page
 * sub-hub pattern: a card grid over a local const, each card linking to one
 * golf-admin surface. Tours / Seasons / Players land in later slices (15, 19);
 * their routes do not exist yet, and the cards deliberately point at them anyway.
 */
const GOLF_SECTIONS = [
  {
    key: 'tournaments',
    title: 'Tournaments',
    description:
      'Create tournaments by hand or from a provider event, then drive field, tiers, workflow, and scores.',
    to: '/manage/golf/tournaments',
  },
  {
    key: 'tours',
    title: 'Tours',
    description:
      'PGA Tour, LIV Golf, and every other tour: the player pool and current world ranking each tournament seeds from.',
    to: '/manage/golf/leagues',
  },
  {
    key: 'seasons',
    title: 'Seasons',
    description:
      "One tour's tournament calendar for a single year. Pre-create future seasons and clone last year's calendar forward.",
    to: '/manage/golf/seasons',
  },
  {
    key: 'players',
    title: 'Players',
    description:
      'The master golfer roster: identities, nationalities, status, and provider mappings.',
    to: '/manage/golf/players',
  },
  {
    key: 'sync',
    title: 'Golf sync',
    description:
      'Provider health, sync history, and manual run actions for golf, in the shared sync operations area.',
    to: '/manage/sync?sport=GOLF',
  },
] as const;

export function RootAdminGolfHubPage() {
  return (
    <section className="space-y-6" data-testid="root-admin-golf-hub-page">
      <section className="grid gap-4 xl:grid-cols-3">
        {GOLF_SECTIONS.map((section) => (
          <ListCard
            actions={(
              <LinkButton
                data-testid={`root-admin-golf-hub-link-${section.key}`}
                to={section.to}
                variant="secondary"
              >
                Open {section.title}
              </LinkButton>
            )}
            description={section.description}
            key={section.key}
            title={section.title}
          />
        ))}
      </section>
    </section>
  );
}
