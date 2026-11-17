import type { ContestDto } from '@/lib/api';
import { CurrentContestList } from '@/features/contests/current-contest-list';
import type { MyContestEntries } from '@/features/contests/use-contest-entries';
import { SectionCard, SectionRow, SectionRows } from '@/features/shared/ui';
import { cupProgress, cupsOnShow, describeCupStanding } from '@/features/championships/cup-view';
import { useSeasonCupsQuery } from '@/features/championships/use-cups-query';
import { buildLeaguePointsRacePath, buildLeagueTrophyCasePath } from './league-routing';

/**
 * League Home's More contests (#1763): every current contest that is not a hero, entered or not,
 * each with the viewer's next step, in the shared row that shows every state. Titled Contests,
 * with one italic line, when there are no heroes and nothing else to list.
 */
export function MoreContestsCard({
  canExpand,
  contests,
  focusContestId,
  hasHeroes,
  hasTeam,
  leagueCode,
  myEntries,
  now,
}: {
  canExpand: boolean;
  contests: readonly ContestDto[];
  focusContestId: string | null;
  hasHeroes: boolean;
  hasTeam: boolean;
  leagueCode: string;
  myEntries: MyContestEntries;
  now: Date;
}) {
  return (
    <SectionCard testId="league-home-more-contests" title={hasHeroes ? 'More contests' : 'Contests'}>
      <CurrentContestList
        canExpand={canExpand}
        contests={contests}
        emptyBody="No open or live contests."
        focusContestId={focusContestId}
        hasTeam={hasTeam}
        leagueCode={leagueCode}
        myEntries={myEntries}
        now={now}
        testIdPrefix="league-home-contest"
      />
    </SectionCard>
  );
}

const HOME_CUPS = 3;

/**
 * The year's sports league cups (#841): who leads each and where the viewer stands, linking to its
 * Points race. Shown once a cup is on show in the Trophy case, which has them all.
 */
export function CupsCard({
  leagueCode,
  leagueId,
  mySquadId,
  year,
}: {
  leagueCode: string;
  leagueId: string;
  mySquadId: string | null;
  year: number;
}) {
  const cupsQuery = useSeasonCupsQuery(leagueId, year);
  const cups = cupsOnShow(cupsQuery.data ?? []);
  if (!cups.length) {
    return null;
  }

  return (
    <SectionCard
      footer={{ label: 'Trophy case', testId: 'league-home-trophy-case', to: buildLeagueTrophyCasePath(leagueCode, year) }}
      testId="league-home-cups"
      title={`${year} cups`}
    >
      <SectionRows>
        {cups.slice(0, HOME_CUPS).map((cup) => {
          const progress = cupProgress(cup);
          return (
            <SectionRow
              facts={`${describeCupStanding(cup, { squadId: mySquadId, isViewer: true })} · ${progress.final} of ${progress.total} final`}
              key={cup.id}
              name={cup.name}
              testId={`league-home-cup-${cup.id}`}
              to={buildLeaguePointsRacePath(leagueCode, year, cup.sportLeagueId)}
            />
          );
        })}
      </SectionRows>
    </SectionCard>
  );
}
