import { Flag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { SportEventDto } from '@/lib/api';
import { IdentityHeading, SegmentedControl, StatusBadge } from '@/features/shared/ui';
import { formatSportEventStatus, sportEventStatusTone } from './golf-admin-utils';
import { buildGolfTournamentPath } from './manage-navigation';

/** The tournament pages a root admin moves between. */
type GolfTournamentView = 'overview' | 'field' | 'tiers' | 'scores';

const VIEW_LABELS: Record<GolfTournamentView, string> = {
  overview: 'Overview',
  field: 'Field',
  tiers: 'Tiers',
  scores: 'Scores',
};

const VIEWS = ['overview', 'field', 'tiers', 'scores'] as const;

/**
 * The header every page of one tournament shares (rules/ux-rules.md §12 rule 9): its name,
 * status and year once, and a sub-menu between Overview, Field, Tiers and Scores.
 */
export function GolfTournamentHeader({
  current,
  tournament,
}: {
  current: GolfTournamentView;
  tournament: SportEventDto;
}) {
  const navigate = useNavigate();
  const basePath = buildGolfTournamentPath(tournament.id);
  const paths: Record<GolfTournamentView, string> = {
    overview: basePath,
    field: `${basePath}/field`,
    tiers: `${basePath}/tiers`,
    scores: `${basePath}/scores`,
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
            <span data-testid="root-admin-golf-tournament-counts">
              {tournament.loadedParticipantCount} golfers · {tournament.tierCount} tiers
            </span>
          </>
        )}
        name={tournament.name}
        testId="root-admin-golf-tournament-identity"
      />
      <nav aria-label="Tournament pages" data-testid="root-admin-golf-tournament-menu">
        <SegmentedControl
          aria-label="Tournament page"
          onChange={(next) => {
            const view = VIEWS.find((candidate) => candidate === next);
            if (view) {
              navigate(paths[view]);
            }
          }}
          options={VIEWS.map((view) => ({
            label: VIEW_LABELS[view],
            testId: `root-admin-golf-tournament-menu-${view}`,
            value: view,
          }))}
          value={current}
        />
      </nav>
    </div>
  );
}
