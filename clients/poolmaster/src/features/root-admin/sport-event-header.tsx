import { getSportDefinition } from '@poolmaster/shared/domain';
import { Flag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { SportEventDto } from '@/lib/api';
import { IdentityHeading, SegmentedControl, StatusBadge } from '@/features/shared/ui';
import { formatSportEventStatus, sportEventStatusTone } from './sport-admin-utils';
import { buildSportEventPath, capitalize } from './manage-navigation';
import { getScoringFamilyAdminUi } from './scoring-family-admin';

const VIEWS = ['overview', 'field', 'tiers', 'results'] as const;

/** The event pages a root admin moves between. */
type SportEventView = (typeof VIEWS)[number];

/**
 * The header every page of one event shares, in every sport (rules/ux-rules.md §12 rule 9): its
 * name, status and year once, and a sub-menu between Overview, Field, Tiers and the results
 * page its scoring family names (Scores for golf, Results for a race).
 */
export function SportEventHeader({
  current,
  tournament,
}: {
  current: SportEventView;
  tournament: SportEventDto;
}) {
  const navigate = useNavigate();
  const { vocabulary } = getSportDefinition(tournament.sport);
  const basePath = buildSportEventPath(tournament.sport, tournament.id);
  const paths: Record<SportEventView, string> = {
    overview: basePath,
    field: `${basePath}/field`,
    tiers: `${basePath}/tiers`,
    results: `${basePath}/results`,
  };
  const labels: Record<SportEventView, string> = {
    overview: 'Overview',
    field: 'Field',
    tiers: 'Tiers',
    results: getScoringFamilyAdminUi(tournament.sport).resultsLabel,
  };

  return (
    <div className="space-y-4">
      <IdentityHeading
        icon={<Flag aria-hidden size={22} />}
        meta={(
          <>
            <StatusBadge tone={sportEventStatusTone(tournament.status)}>
              {formatSportEventStatus(tournament.status)}
            </StatusBadge>
            <span>{tournament.eventYear}</span>
            <span data-testid="root-admin-sport-event-counts">
              {`${tournament.loadedParticipantCount} ${tournament.loadedParticipantCount === 1 ? vocabulary.participant.one : vocabulary.participant.many} · ${tournament.tierCount} ${tournament.tierCount === 1 ? 'tier' : 'tiers'}`}
            </span>
          </>
        )}
        name={tournament.name}
        testId="root-admin-sport-event-identity"
      />
      <nav aria-label={`${capitalize(vocabulary.event.one)} pages`} data-testid="root-admin-sport-event-menu">
        <SegmentedControl
          aria-label={`${capitalize(vocabulary.event.one)} page`}
          onChange={(next) => {
            const view = VIEWS.find((candidate) => candidate === next);
            if (view) {
              navigate(paths[view]);
            }
          }}
          options={VIEWS.map((view) => ({
            label: labels[view],
            testId: `root-admin-sport-event-menu-${view}`,
            value: view,
          }))}
          value={current}
        />
      </nav>
    </div>
  );
}
