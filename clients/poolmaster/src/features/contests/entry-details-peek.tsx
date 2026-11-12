import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatUserName } from '@/features/account/user-name';
import { buildLeagueTeamHomePath } from '@/features/leagues/league-routing';
import { DetailsPeek, PeekCard, QueryState } from '@/features/shared/ui';
import { formatOwnerCount, getActiveOwners } from '@/features/teams/team-directory';
import { leagueSquadQueryOptions } from '@/features/teams/use-league-squad-query';

/**
 * How long a peeked team stays fresh: a leaderboard is scanned for minutes, and a team's name
 * and owners rarely change in that time, so hovering a team's entries again reads nothing.
 */
const TEAM_PEEK_STALE_MS = 5 * 60_000;

function teamPeekQuery(leagueId: string, squadId: string) {
  return { ...leagueSquadQueryOptions(leagueId, squadId), staleTime: TEAM_PEEK_STALE_MS };
}

/**
 * The (i) after an entry's name (#1564): rows name an entry alone, and this peek says whose it
 * is, the team's name and its owners. The team is read when the peek first opens (a mouse
 * starts the read as it arrives), once per team, and not before.
 */
export function EntryDetailsPeek({
  className,
  entryName,
  leagueCode,
  leagueId,
  squadId,
  testId,
}: {
  className?: string;
  entryName: string;
  leagueCode: string;
  leagueId: string;
  squadId: string;
  testId: string;
}) {
  const queryClient = useQueryClient();
  return (
    <DetailsPeek
      className={className}
      label={`About ${entryName}`}
      onHoverStart={() => {
        // A failed read shows in the card when it opens; starting it early needs no handler.
        queryClient.query(teamPeekQuery(leagueId, squadId)).catch(() => undefined);
      }}
      testId={testId}
    >
      <EntryTeamCard leagueCode={leagueCode} leagueId={leagueId} squadId={squadId} testId={testId} />
    </DetailsPeek>
  );
}

function EntryTeamCard({ leagueCode, leagueId, squadId, testId }: { leagueCode: string; leagueId: string; squadId: string; testId: string }) {
  const teamQuery = useQuery(teamPeekQuery(leagueId, squadId));
  return (
    <QueryState error="We couldn't load this team." loading="Loading team..." query={teamQuery} testId={testId}>
      {(team) => {
        const owners = getActiveOwners(team).map((member) => formatUserName(member.user.firstName, member.user.lastName));
        return (
          <PeekCard
            facts={[{ label: owners.length === 1 ? 'Owner' : 'Owners', value: owners.length ? owners.join(', ') : 'None' }]}
            link={{ label: 'Team page', testId: `${testId}-team-link`, to: buildLeagueTeamHomePath(leagueCode, team.id) }}
            subtitle={`Team · ${formatOwnerCount(team)}`}
            testId={`${testId}-card`}
            title={team.name}
          />
        );
      }}
    </QueryState>
  );
}
