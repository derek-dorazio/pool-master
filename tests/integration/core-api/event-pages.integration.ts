/**
 * Event pages (#1007) against Postgres: the pages and offers the migrations seed, the editions of
 * a series the pages read, and whether a squares offer still has a game to be played on. No mocks.
 */
import { randomUUID } from 'node:crypto';
import {
  SelectionType,
  Sport,
  SportEventStatus,
  isEventPageSlug,
} from '@poolmaster/shared/domain';
import { PrismaEventPageRepository } from '../../../packages/core-api/src/adapters';
import { createContestOpeningReader } from '../../../packages/core-api/src/modules/contest-management/wiring';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { cleanupFreshEventEditions, freshEventEdition } from '../../support/event-edition';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await cleanupFreshEventEditions(getPrisma());
  await teardownIntegrationTests();
});

const NOW = new Date('2030-01-10T12:00:00.000Z');

describe('Seeded event pages', () => {
  it('seeds Championship Weekend with the Clutch Card first and primary, the NFL bracket from the conference round, then NFL Squares', async () => {
    const pages = new PrismaEventPageRepository(getAppPrisma());

    const page = await pages.findBySportSlug(Sport.AMERICAN_FOOTBALL, 'championship-weekend');
    const offers = await pages.findOffers([page?.id ?? '']);

    expect(page).toMatchObject({ isActive: true, redirectTo: null });
    expect(offers.map((offer) => [offer.sportLeagueName, offer.eventSeriesName, offer.template.templateKey, offer.bracketStartRound, offer.isPrimary])).toEqual([
      ['Championship Weekend', 'Conference Championships', 'championship-weekend-tiered-redzone', null, true],
      ['NFL', 'NFL Playoffs', 'nfl-bracket-second-chance-doubling', 3, false],
      ['NFL', 'NFL Playoffs', 'nfl-squares', null, false],
    ]);
  });

  it('gives every page a valid slug and exactly one primary offer, and every offer an active template its sport league can use', async () => {
    const rows = await getPrisma().eventPage.findMany({
      include: { offers: { include: { template: true, sportLeague: { include: { sport: true } } } } },
    });

    expect(rows.length).toBeGreaterThan(0);
    const problems = rows.flatMap((page) => [
      ...(isEventPageSlug(page.slug) ? [] : [`${page.slug}: not a valid slug`]),
      ...(page.offers.filter((offer) => offer.isPrimary).length === 1 ? [] : [`${page.slug}: not exactly one primary offer`]),
      ...page.offers.flatMap((offer) => [
        ...(offer.template.active ? [] : [`${page.slug}: ${offer.template.templateKey} is inactive`]),
        ...(offer.sportLeague.sport.sport === page.sport && offer.template.sport === page.sport ? [] : [`${page.slug}: ${offer.template.templateKey} is another sport's`]),
        ...(offer.template.sportLeagueId === null || offer.template.sportLeagueId === offer.sportLeagueId ? [] : [`${page.slug}: ${offer.template.templateKey} is another sport league's`]),
        ...(offer.bracketStartRound === null || offer.template.selectionType === SelectionType.BRACKET ? [] : [`${page.slug}: a starting round on ${offer.template.templateKey}, not a bracket`]),
      ]),
    ]);
    expect(problems).toEqual([]);
  });

  it('refuses a slug that is not lower case words joined by single dashes', async () => {
    const prisma = getPrisma();

    await expect(prisma.eventPage.create({ data: { sport: Sport.GOLF, slug: 'The-Masters', displayOrder: 1 } })).rejects.toThrow();
    await expect(prisma.eventPage.create({ data: { sport: Sport.GOLF, slug: 'the--masters', displayOrder: 1 } })).rejects.toThrow();
  });
});

describe('Event page offers', () => {
  /** A throwaway golf page with the seeded Clutch Card's league and a copy of its template, removed after. */
  async function scratchPage(templateActive: boolean) {
    const prisma = getPrisma();
    const seeded = await prisma.eventPageOffer.findFirstOrThrow({ where: { isPrimary: true, eventPage: { slug: 'championship-weekend' } }, include: { template: true } });
    const template = seeded.template;
    const copy = await prisma.contestConfigTemplate.create({
      data: {
        sport: template.sport,
        sportLeagueId: template.sportLeagueId,
        contestFormat: template.contestFormat,
        selectionType: template.selectionType,
        templateKey: `event-page-${randomUUID()}`,
        name: template.name,
        description: template.description,
        sortOrder: template.sortOrder,
        active: templateActive,
        configJson: template.configJson ?? {},
      },
    });
    const page = await prisma.eventPage.create({ data: { sport: Sport.GOLF, slug: `scratch-${randomUUID()}`, displayOrder: 999 } });
    const offer = (sortOrder: number, isPrimary: boolean) => prisma.eventPageOffer.create({
      data: { eventPageId: page.id, sportLeagueId: seeded.sportLeagueId, eventSeriesName: 'Scratch', templateId: copy.id, sortOrder, isPrimary },
    });
    const remove = async () => {
      await prisma.eventPage.delete({ where: { id: page.id } });
      await prisma.contestConfigTemplate.delete({ where: { id: copy.id } });
    };
    return { page, offer, remove };
  }

  it('refuses a second primary offer on one page, so one edition alone heads it', async () => {
    const { offer, remove } = await scratchPage(true);
    try {
      await offer(1, true);
      await offer(2, false);

      await expect(offer(3, true)).rejects.toThrow();
    } finally {
      await remove();
    }
  });

  it('leaves out an offer whose setup is inactive, as Create contest refuses it', async () => {
    const { page, offer, remove } = await scratchPage(false);
    try {
      await offer(1, true);

      expect(await new PrismaEventPageRepository(getAppPrisma()).findOffers([page.id])).toEqual([]);
    } finally {
      await remove();
    }
  });
});

describe('PrismaEventPageRepository.findEditionsNotOver', () => {
  it('reads the edition under way first, then the rest soonest first, leaving out finished ones', async () => {
    const prisma = getPrisma();
    const edition = await freshEventEdition(prisma, { name: 'Event page editions' });
    const series = await prisma.eventSeries.findUniqueOrThrow({ where: { id: edition.eventSeriesId } });
    const make = (eventYear: number, status: SportEventStatus, startDate: string) => prisma.sportEvent.create({
      data: {
        eventSeriesId: series.id, eventYear, status, startDate: new Date(startDate),
        externalId: `event-page-${randomUUID()}`, providerId: 'integration-test', sport: Sport.GOLF, name: `${series.name} ${eventYear}`,
      },
    });
    await make(2025, SportEventStatus.COMPLETED, '2025-04-10T12:00:00.000Z');
    await make(2028, SportEventStatus.DRAFT, '2028-04-10T12:00:00.000Z');
    await make(2027, SportEventStatus.SCHEDULED, '2027-04-10T12:00:00.000Z');
    await make(2026, SportEventStatus.IN_PROGRESS, '2026-04-10T12:00:00.000Z');
    await make(2029, SportEventStatus.CANCELLED, '2029-04-10T12:00:00.000Z');

    const editions = await new PrismaEventPageRepository(getAppPrisma()).findEditionsNotOver(series.sportLeagueId, series.name);

    expect(editions.map((each) => each.eventYear)).toEqual([2026, 2027, 2028]);
  });
});

describe('createContestOpeningReader.nextSquaresKickoff', () => {
  it('gives the kickoff of the next game a squares contest could still be played on, and none once the last is cancelled', async () => {
    const prisma = getPrisma();
    const sportEvent = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma, { name: 'Event page squares' })),
        externalId: `event-page-squares-${randomUUID()}`, providerId: 'integration-test', sport: Sport.AMERICAN_FOOTBALL,
        name: 'Event page squares', startDate: new Date('2030-01-09T18:00:00.000Z'), status: SportEventStatus.IN_PROGRESS,
      },
    });
    const round = await prisma.sportEventRound.create({ data: { sportEventId: sportEvent.id, roundNumber: 1, scheduledDate: sportEvent.startDate } });
    await prisma.sportEventMatch.create({
      data: { sportEventId: sportEvent.id, sportEventRoundId: round.id, matchNumber: 1, isNeutralSite: false, status: 'COMPLETED', scheduledDate: sportEvent.startDate },
    });
    const ahead = await prisma.sportEventMatch.create({
      data: { sportEventId: sportEvent.id, sportEventRoundId: round.id, matchNumber: 2, isNeutralSite: false, scheduledDate: new Date('2030-01-24T20:00:00.000Z') },
    });
    const reader = createContestOpeningReader(getAppPrisma());
    const state = await reader.findById(sportEvent.id);
    if (state === null) throw new Error('The event was not read back.');

    expect(await reader.nextSquaresKickoff(state, NOW)).toEqual(new Date('2030-01-24T20:00:00.000Z'));
    await prisma.sportEventMatch.update({ where: { id: ahead.id }, data: { status: 'CANCELLED' } });
    expect(await reader.nextSquaresKickoff(state, NOW)).toBeNull();
  });
});
