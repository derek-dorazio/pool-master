import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router';
import { sportLeagueDefinitionOf, type Sport } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto, SportEventDto } from '@/lib/api';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import {
  buildLeagueAdminContestCreateFromTemplatePath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { contestEventsForTemplate } from '@/features/contests/contest-template-events';
import { sportEventsQueryOptions } from '@/features/contests/sport-events-query';
import { useActiveContestTemplatesQuery } from '@/features/contests/use-active-contest-templates-query';
import { Heading, Notice, PageHeader, QueryState, refetchFailed, SectionCard, Text } from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { buildLeagueContestCatalog, contestTypeCount } from './contest-catalog';
import { ContestTypeTileCard } from './contest-type-tile';
import { SPORT_BLURBS } from './sport-blurbs';
import { EveryLeagueCard } from './every-league-card';
import { SportChipRow } from './sport-chip-row';
import { groupRounds, useSportLeagueChoice } from './sport-league-choice';
import { SportLeagueColumn } from './sport-league-column';
import { STAT_POOL_CONTEST_TYPE, statPoolScoringLine } from '@/features/contests/scoring-family-ui/stat-pool-copy';
import { useSportLeaguesQuery } from './use-sport-leagues-query';

/** The contest types' anchor, which a league picked further down the page scrolls back to. */
const CONTEST_TYPES_ANCHOR = 'contest-types';

/** Back up to the contest types, from a league picked below them on a phone. */
function scrollToTypes() {
  document.getElementById(CONTEST_TYPES_ANCHOR)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/**
 * Contest types (#803): every contest the league could run, grouped by sport and sport league,
 * read from the contest templates: each sport league lists its own and its sport's every-event
 * types (#1716), since a contest is always created in one. A commissioner of an active league
 * gets a "Create this contest" link on each, opening Create contest on that template in that
 * sport league; every other member sees the same menu without them. The sport switch, a column of every sport and league on a computer and
 * chips on a phone as on How to Play (#1701), narrows it to one sport, league or playoff round,
 * and the choice is kept in the link.
 */
export function LeagueContestTypesPage() {
  const logger = useMemo(() => getLogger().child({ feature: 'league-contest-types-page' }), []);
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { query: leagueQuery, league } = useLeagueContext(leagueCode);
  // Commissioner tools admits only commissioners and root admins; an inactive league creates nothing.
  const canCreate = league?.isActive === true;

  const templatesQuery = useActiveContestTemplatesQuery();
  const sportLeaguesQuery = useSportLeaguesQuery();
  const catalog = useMemo(
    () => buildLeagueContestCatalog(templatesQuery.data ?? [], sportLeaguesQuery.data ?? []),
    [sportLeaguesQuery.data, templatesQuery.data],
  );
  // The switch offers each sport's leagues, each playoff round under its season league (#1701),
  // and counts the contest types the sport lists (#1716).
  const filterable = useMemo(() => catalog.map((sport) => ({
    ...sport,
    count: contestTypeCount(sport.groups),
    leagues: groupRounds(sport.groups.map((group) => ({ ...group, id: group.sportLeagueId, parentId: group.parentSportLeagueId })))
      .map(({ league, rounds }) => ({ slug: league.slug, name: league.name, rounds: rounds.map(({ slug, name }) => ({ slug, name })) })),
  })), [catalog]);
  const choice = useSportLeagueChoice(filterable);
  const shownSports = choice.sport
    ? [{ ...choice.sport, groups: choice.sport.groups.filter((group) => choice.leagueSlugs === null || choice.leagueSlugs.includes(group.slug)) }]
    : catalog;

  // A championship stat pool league's group says it is a Clutch Card and how its stat is counted (#936).
  const statPoolLines = useMemo(() => new Map((sportLeaguesQuery.data ?? []).flatMap((sportLeague) => {
    const line = statPoolScoringLine(sportLeagueDefinitionOf(sportLeague.sport, sportLeague));
    return line === null ? [] : [[sportLeague.id, `${STAT_POOL_CONTEST_TYPE}. Each star scores ${line}`] as const];
  })), [sportLeaguesQuery.data]);

  // A commissioner's create links need each sport's events: a contest type with none coming up
  // says so instead of linking.
  const sports = useMemo(() => catalog.map(({ sport }) => sport), [catalog]);
  const eventQueries = useQueries({ queries: sports.map((sport) => sportEventsQueryOptions(sport, canCreate)) });
  const eventsBySport = new Map<Sport, SportEventDto[] | undefined>(sports.map((sport, index) => [sport, eventQueries[index]?.data]));

  const isError = templatesQuery.isError || sportLeaguesQuery.isError;
  useEffect(() => {
    if (isError) {
      logger.warn({ action: 'contestTypes.load.failed', data: { leagueCode } }, 'Contest types page failed to load the contest types');
    }
  }, [isError, leagueCode, logger]);

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading contest types...' });
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }

  // Create opens on the section's sport league (#1716). While a sport's events load, its links
  // stand; once they arrive, a type with no event in that league coming up says so.
  const createPathFor = (sportLeagueId: string) => (canCreate
    ? (template: ContestConfigTemplateDto) => {
      const events = eventsBySport.get(template.sport);
      return events === undefined || contestEventsForTemplate(events.filter((event) => event.sportLeagueId === sportLeagueId), template).length
        ? buildLeagueAdminContestCreateFromTemplatePath(league.leagueCode, template.id, sportLeagueId)
        : null;
    }
    : undefined);

  return (
    <section className="space-y-8" data-testid="league-contest-types-page">
      <PageHeader testId="contest-types-header" title="Contest types" />
      {canCreate ? null : (
        <Notice data-testid="contest-types-inactive" tone="warning">
          {`${league.name} can run these once the league is active again.`}
        </Notice>
      )}

      <QueryState
        error="We couldn't load the contest types."
        loading="Loading contest types..."
        query={{
          data: templatesQuery.isSuccess && sportLeaguesQuery.isSuccess ? catalog : undefined,
          isError,
          refetch: refetchFailed(templatesQuery, sportLeaguesQuery),
        }}
        size="tile"
        testId="contest-types-catalog"
      >
        {() => (
        <div className="md:grid md:grid-cols-[200px_minmax(0,1fr)] md:items-start md:gap-6">
          <SportLeagueColumn choice={choice} className="sticky top-4 max-md:hidden" sports={filterable} testId="contest-types-leagues-column" />
          <div className="min-w-0 space-y-6">
            <SportChipRow choice={choice} className="md:hidden" sports={filterable} testId="contest-types-sport-chips" />
            <div className="scroll-mt-4 space-y-10" id={CONTEST_TYPES_ANCHOR}>
              {shownSports.map((sport) => (
                <SectionCard bare help={SPORT_BLURBS[sport.sport]} key={sport.sport} testId={`contest-types-sport-${sport.sport}`} title={sport.name}>
                  {sport.groups.map((group) => (
                    <div className="space-y-3" key={group.sportLeagueId}>
                      <Heading level={4} variant="eyebrow">{group.name}</Heading>
                      {statPoolLines.has(group.sportLeagueId) ? (
                        <Text as="p" data-testid={`contest-types-stat-pool-${group.sportLeagueId}`} variant="meta">
                          {statPoolLines.get(group.sportLeagueId)}
                        </Text>
                      ) : null}
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {group.tiles.map((tile) => (
                          <ContestTypeTileCard createPathFor={createPathFor(group.sportLeagueId)} key={tile.key} testId={`contest-type-${group.slug}`} tile={tile} />
                        ))}
                      </div>
                    </div>
                  ))}
                </SectionCard>
              ))}
            </div>
            <EveryLeagueCard className="md:hidden" onPick={scrollToTypes} sports={filterable} testId="contest-types-every-league" />
          </div>
        </div>
        )}
      </QueryState>
    </section>
  );
}
