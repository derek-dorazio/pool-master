/**
 * #1242, #1248 — the fixtures the list-route query-scaling tests seed: leagues with their teams,
 * golf events with a field, and NFL weeks with their games. Each seeds the child rows a route
 * lists at any count, so one case can read 2 and then 20.
 *
 * Scaffolding only: no assertions and no route reads here.
 */
import { randomUUID } from 'crypto';
import { MatchSide, MatchStatus, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import type { Response } from 'light-my-request';
import type { z } from 'zod';
import { createTestUser, getApp, getPrisma, type TestUserResult } from './helpers';
import { freshEventEdition } from '../support/event-edition';

export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;

/** The route's 200 body, parsed with its response schema; anything else fails the case before its count is compared. */
export function okBody<Schema extends z.ZodType>(response: Response, schema: Schema): z.infer<Schema> {
  expect(response.statusCode).toBe(200);
  return schema.parse(response.json());
}

export function get(url: string, viewer: TestUserResult) {
  return getApp().inject({ method: 'GET', url, headers: viewer.headers });
}

/** A league run by `commissioner`, with `teams` members who each own a team of their own. */
export async function seedLeagueWithTeams(teams: number) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const commissioner = await createTestUser({ displayName: `Scaling Commissioner ${suffix}` });
  const league = await prisma.league.create({
    data: { cupName: 'Scaling Cup', leagueCode: `SCALE${suffix.toUpperCase()}`, name: `Scaling League ${suffix}` },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: commissioner.user.id, role: 'COMMISSIONER', status: 'ACTIVE' },
  });
  const squads = [];
  for (let index = 0; index < teams; index += 1) {
    const member = await createTestUser({ displayName: `Scaling Member ${suffix}${index}` });
    await prisma.leagueMembership.create({ data: { leagueId: league.id, userId: member.user.id, role: 'MEMBER', status: 'ACTIVE' } });
    const squad = await prisma.squad.create({ data: { leagueId: league.id, createdBy: member.user.id, name: `Team ${suffix} ${index}` } });
    await prisma.squadMembership.create({ data: { squadId: squad.id, leagueId: league.id, userId: member.user.id } });
    squads.push(squad);
  }
  return { commissioner, league, squads, suffix };
}

interface EventOptions {
  /** When it starts, from now: negative for one already under way or played. Next month by default. */
  startsInDays?: number;
  status?: SportEventStatus;
  /** Its series in a golf sports league of its own instead of the shared fixture tour, so a read per sports league scales too. */
  ownSportLeague?: boolean;
}

/** A golf event with a field of `golfers`. */
export async function seedEventWithField(golfers: number, { startsInDays = 30, status = SportEventStatus.SCHEDULED, ownSportLeague = false }: EventOptions = {}) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const startDate = new Date(Date.now() + startsInDays * DAY);
  const edition = await freshEventEdition(prisma, { eventYear: startDate.getUTCFullYear() });
  if (ownSportLeague) {
    const tour = await prisma.sportLeague.create({ data: { sportId: sport.id, name: `Scaling Tour ${suffix}` } });
    await prisma.eventSeries.update({ where: { id: edition.eventSeriesId }, data: { sportLeagueId: tour.id } });
  }
  const event = await prisma.sportEvent.create({
    data: {
      ...edition,
      externalId: `scaling-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Scaling Open ${suffix}`,
      startDate,
      endDate: new Date(startDate.getTime() + 3 * DAY),
      status,
    },
  });
  const field = [];
  for (let index = 0; index < golfers; index += 1) {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `Golfer ${suffix} ${index}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
    });
    field.push(await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, isActive: true } }));
  }
  return { event, field };
}

/** `tiers` tiers on the event, its field dealt into them in turn: golfer N in tier N mod `tiers`. */
export async function seedTiers(sportEventId: string, field: readonly { id: string }[], tiers: number) {
  const prisma = getPrisma();
  const rows: { id: string }[] = [];
  for (let tierNumber = 1; tierNumber <= tiers; tierNumber += 1) {
    rows.push(await prisma.sportEventTier.create({ data: { sportEventId, tierKey: `T${String(tierNumber)}`, label: `Tier ${String(tierNumber)}`, tierNumber } }));
  }
  await prisma.sportEventParticipantValuation.createMany({
    data: field.map((row, index) => ({ sportEventParticipantId: row.id, sportEventTierId: rows[index % tiers]?.id, tierOrderIndex: Math.floor(index / tiers) + 1 })),
  });
}

/**
 * An NFL week of `games` games an hour apart from `startDate`, each between two teams of its own,
 * so no two weeks share a team. With `played`, the first that many games are final, the home
 * team winning 20-17.
 */
export async function seedFootballWeek({ games, startDate, status, played = 0 }: { games: number; startDate: Date; status: SportEventStatus; played?: number }) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  // The integration cleanup empties sport leagues no template names, so the football rows are set up here.
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.AMERICAN_FOOTBALL },
    create: { sport: Sport.AMERICAN_FOOTBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: 'NFL' } },
    create: { sportId: sport.id, name: 'NFL' },
    update: {},
  });
  const eventSeries = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `Scaling Week ${suffix}` } });
  const event = await prisma.sportEvent.create({
    data: {
      eventSeriesId: eventSeries.id,
      eventYear: startDate.getUTCFullYear(),
      externalId: `scaling-week-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.AMERICAN_FOOTBALL,
      name: `Scaling Week ${suffix}`,
      startDate,
      status,
      rounds: 1,
    },
  });
  const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 1, scheduledDate: startDate } });
  const matches = [];
  for (let matchNumber = 1; matchNumber <= games; matchNumber += 1) {
    const team = async (side: string) => {
      const participant = await prisma.participant.create({ data: { sportId: sport.id, name: `${side} ${suffix} ${matchNumber}`, participantType: 'TEAM' } });
      return prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, isActive: true } });
    };
    const [home, away] = await Promise.all([team('Home'), team('Away')]);
    const final = matchNumber <= played;
    matches.push(await prisma.sportEventMatch.create({
      data: {
        sportEventId: event.id,
        sportEventRoundId: round.id,
        matchNumber,
        homeSportEventParticipantId: home.id,
        awaySportEventParticipantId: away.id,
        isNeutralSite: false,
        scheduledDate: new Date(startDate.getTime() + (matchNumber - 1) * HOUR),
        ...(final ? { status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 20, awayScore: 17 } : {}),
      },
    }));
  }
  return { event, games: matches };
}
