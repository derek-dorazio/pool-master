import { getSportDefinition, sportLeagueDefinitionOf, type SelectionType, type Sport, type SportDefinition } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto, SportLeagueDto } from '@/lib/api';

/**
 * One contest type on the contest types pages (#803): a format as one sport league offers it, on
 * one kind of event. It leads with its default template and lists the league's other templates of
 * that format as variations.
 */
export interface ContestTypeTile {
  key: string;
  selectionType: SelectionType;
  /**
   * Whether another tile of its section has the same format on another kind of event (the NFL's
   * weekly and playoff Survivor), so the tile names its kind of event beside its format.
   */
  sharesFormat?: boolean;
  featured: ContestConfigTemplateDto;
  variations: ContestConfigTemplateDto[];
}

/** A sport league's contest types on Contest types: its own templates (#1825: every template has one league). */
export interface ContestCatalogLeague {
  sportLeagueId: string;
  /** What the page calls it, as How to Play does: "NCAA Men's Hockey", not "NCAA Division I Men". */
  name: string;
  /** Its stored URL segment, its name in the page's link: `?sport=golf&league=pga-tour`. */
  urlSegment: string;
  tiles: ContestTypeTile[];
}

export interface ContestCatalogSport<Group> {
  sport: Sport;
  /** The sport's URL segment, its name in the page's link: `?sport=golf`. */
  urlSegment: string;
  name: string;
  groups: Group[];
}

/** The default first, then by sort order, then by key, so a page reads the same on every load. */
function byFeaturedOrder(left: ContestConfigTemplateDto, right: ContestConfigTemplateDto) {
  return Number(right.isDefault) - Number(left.isDefault)
    || left.sortOrder - right.sortOrder
    || left.templateKey.localeCompare(right.templateKey);
}

function groupBy<Item>(items: readonly Item[], keyOf: (item: Item) => string) {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

/**
 * One tile per format and kind of event, in the sport's format order, each led by its default,
 * the format's other templates as its variations. `key` names the sport league, so the same
 * setup under two leagues is two tiles.
 */
function toTiles(
  key: string,
  templates: readonly ContestConfigTemplateDto[],
  selectionTypes: readonly SelectionType[],
): ContestTypeTile[] {
  return groupBy(templates, (template) => `${template.eventType ?? 'any'}/${template.selectionType}`)
    .map((group) => {
      const [featured, ...variations] = [...group].sort(byFeaturedOrder) as [ContestConfigTemplateDto, ...ContestConfigTemplateDto[]];
      return {
        key: `${key}/${featured.eventType ?? 'any'}/${featured.selectionType}`,
        selectionType: featured.selectionType,
        featured,
        variations,
      };
    })
    .sort((left, right) => selectionTypes.indexOf(left.selectionType) - selectionTypes.indexOf(right.selectionType)
      || byFeaturedOrder(left.featured, right.featured))
    .map((tile, _index, tiles) => ({ ...tile, sharesFormat: tiles.some((other) => other !== tile && other.selectionType === tile.selectionType) }));
}

/** How many contest types sport league sections list together: the number beside a sport on Contest types. */
export function contestTypeCount(leagues: readonly Pick<ContestCatalogLeague, 'tiles'>[]) {
  return leagues.reduce((count, league) => count + league.tiles.length, 0);
}

/** A sport as its sport leagues carry it: its URL segment and display order, read from the API. */
interface CatalogSportRef {
  sport: Sport;
  urlSegment: string;
}

/**
 * Each sport with an active sport league, in the sports' display order (SportDto.displayOrder,
 * which each league carries), the NFL's sport first: the order both catalogs list sports in.
 */
function sportsInDisplayOrder(sportLeagues: readonly SportLeagueDto[]): CatalogSportRef[] {
  const bySport = new Map<Sport, SportLeagueDto>();
  for (const sportLeague of sportLeagues) {
    if (sportLeague.isActive && !bySport.has(sportLeague.sport)) {
      bySport.set(sportLeague.sport, sportLeague);
    }
  }
  return [...bySport.values()]
    .sort((left, right) => left.sportDisplayOrder - right.sportDisplayOrder)
    .map((sportLeague) => ({ sport: sportLeague.sport, urlSegment: sportLeague.sportUrlSegment }));
}

/**
 * The league contest types page's catalog (#1716): each sport in the sports' display order, a section
 * for each of its active sport leagues in display order, listing every contest type a contest in
 * that league can be created from: its own templates, one tile per format and kind of event.
 * A contest is always created in a sport league,
 * so there is no section for every event. A sport league with none is left out, as is a sport
 * with no sport league.
 */
export function buildLeagueContestCatalog(
  templates: readonly ContestConfigTemplateDto[],
  sportLeagues: readonly SportLeagueDto[],
): ContestCatalogSport<ContestCatalogLeague>[] {
  return sportsInDisplayOrder(sportLeagues).flatMap(({ sport, urlSegment }) => {
    const sportTemplates = templates.filter((template) => template.sport === sport);
    const groups = activeSportLeaguesOf(sport, sportLeagues)
      .map((sportLeague) => {
        const definition = sportLeagueDefinitionOf(sport, sportLeague);
        return {
          sportLeagueId: sportLeague.id,
          name: sportLeague.displayName ?? sportLeague.name,
          urlSegment: sportLeague.urlSegment,
          tiles: toTiles(sportLeague.id, offeredIn(sportLeague, definition, sportTemplates), definition.selectionTypes),
        };
      })
      .filter((league) => league.tiles.length > 0);
    return groups.length ? [{ sport, urlSegment, name: getSportDefinition(sport).name, groups }] : [];
  });
}

/** A sport league on the public How to Play page: the formats its own templates offer. */
export interface PublicCatalogLeague {
  sportLeagueId: string;
  /** What the page calls it beside other sports' leagues: "NCAA Men's Basketball", not "NCAA Division I Men". */
  name: string;
  /** Its stored URL segment, its name in the page's link: `?sport=basketball&league=wnba`. */
  urlSegment: string;
  /** What it plays: its sport's definition, with what the league overrides. */
  definition: SportDefinition;
  groups: ContestTypeTile[];
}

export interface PublicCatalogSport extends ContestCatalogSport<ContestTypeTile> {
  leagues: PublicCatalogLeague[];
}

/** One tile per format, in the sport's format order, each led by its default, with no variations. */
function toFormatTiles(
  key: string,
  templates: readonly ContestConfigTemplateDto[],
  selectionTypes: readonly SelectionType[],
): ContestTypeTile[] {
  return groupBy(templates, (template) => template.selectionType)
    .map((group) => {
      const [featured] = [...group].sort(byFeaturedOrder) as [ContestConfigTemplateDto, ...ContestConfigTemplateDto[]];
      return { key: `${key}/${featured.selectionType}`, selectionType: featured.selectionType, featured, variations: [] };
    })
    .sort((left, right) => selectionTypes.indexOf(left.selectionType) - selectionTypes.indexOf(right.selectionType));
}

/** Sport leagues in their display order, the NFL before the College Football Playoff; unordered ones after, by name. */
function bySportLeagueDisplayOrder(left: SportLeagueDto, right: SportLeagueDto) {
  return (left.displayOrder ?? Number.MAX_SAFE_INTEGER) - (right.displayOrder ?? Number.MAX_SAFE_INTEGER)
    || (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name);
}

/** A sport's active sport leagues, in display order. */
function activeSportLeaguesOf(sport: Sport, sportLeagues: readonly SportLeagueDto[]) {
  return sportLeagues
    .filter((sportLeague) => sportLeague.sport === sport && sportLeague.isActive)
    .sort(bySportLeagueDisplayOrder);
}

/** The templates a contest in a sport league can be created from: its own, in the formats it plays. */
function offeredIn(sportLeague: SportLeagueDto, definition: SportDefinition, sportTemplates: readonly ContestConfigTemplateDto[]) {
  return sportTemplates.filter((template) => template.sportLeagueId === sportLeague.id
    && definition.selectionTypes.includes(template.selectionType));
}

/**
 * The public How to Play page's catalog: each sport in the sports' display order, with its formats,
 * one tile each, led by the format's default of the first sport league to offer it; then each of
 * its active sport leagues in display order, with the formats it offers, its own templates leading
 * its sport's, and the definition it plays. A sport league that offers none is left out, as is a sport with no templates
 * or with no active sport league: one whose every league is switched off (#1812) gets no chip.
 */
export function buildPublicContestCatalog(
  templates: readonly ContestConfigTemplateDto[],
  sportLeagues: readonly SportLeagueDto[],
): PublicCatalogSport[] {
  return sportsInDisplayOrder(sportLeagues).flatMap(({ sport, urlSegment }) => {
    const definition = getSportDefinition(sport);
    const activeLeagues = activeSportLeaguesOf(sport, sportLeagues);
    // A switched-off league's own setups (#1812) shape none of its sport's tiles.
    const activeLeagueIds = new Set(activeLeagues.map((sportLeague) => sportLeague.id));
    const sportTemplates = templates.filter((template) => template.sport === sport
      && activeLeagueIds.has(template.sportLeagueId));
    const groups = toFormatTiles(sport, sportTemplates, definition.selectionTypes);
    const leagues = activeLeagues
      .map((sportLeague) => {
        const leagueDefinition = sportLeagueDefinitionOf(sport, sportLeague);
        return {
          sportLeagueId: sportLeague.id,
          name: sportLeague.displayName ?? sportLeague.name,
          urlSegment: sportLeague.urlSegment,
          definition: leagueDefinition,
          groups: toFormatTiles(
            `${sport}/${sportLeague.id}`,
            offeredIn(sportLeague, leagueDefinition, sportTemplates),
            leagueDefinition.selectionTypes,
          ),
        };
      })
      .filter((league) => league.groups.length > 0);
    return groups.length && activeLeagues.length ? [{ sport, urlSegment, name: definition.name, groups, leagues }] : [];
  });
}
