/**
 * Contest templates: the commissioner's list and the root admin's edits, against a stateful
 * template store that filters the way the Prisma adapter does. Tests assert the stored rows.
 */
import type { ContestConfigTemplateRepository } from '@poolmaster/shared/db';
import type { ContestConfigTemplate } from '@poolmaster/shared/domain';
import { ContestFormat, SelectionType, Sport } from '@poolmaster/shared/domain';
import {
  ContestConfigTemplateNotFoundError,
  ContestConfigTemplateService,
} from '../../../packages/core-api/src/modules/contest-config-templates/service';

function template(overrides: Partial<ContestConfigTemplate>): ContestConfigTemplate {
  return {
    id: 'template',
    sport: Sport.GOLF,
    sportLeagueId: null,
    eventType: null,
    contestFormat: ContestFormat.ROSTER,
    selectionType: SelectionType.TIERED,
    templateKey: 'golf-tiered',
    name: 'Pick 6, count 4',
    description: 'Tiered golf',
    sortOrder: 1,
    isDefault: false,
    active: true,
    configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
    eventSeriesNames: [],
    schemaVersion: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/**
 * Mirrors PrismaContestConfigTemplateRepository.list: an event type also matches "any event type",
 * and a sport league also matches the sport-wide (no league) templates.
 */
function templateStore(rows: ContestConfigTemplate[]) {
  const store = new Map(rows.map((row) => [row.id, row]));
  const repository: ContestConfigTemplateRepository = {
    findById: async (id) => store.get(id) ?? null,
    list: async (input = {}) => [...store.values()]
      // No format filter: every template is ROSTER while that enum has one member.
      .filter((row) =>
        (input.sport === undefined || row.sport === input.sport)
        && (input.eventType === undefined || row.eventType === input.eventType || row.eventType == null)
        && (input.sportLeagueId === undefined || row.sportLeagueId === input.sportLeagueId || row.sportLeagueId === null)
        && (input.active === undefined || row.active === input.active))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)),
    update: async (id, updates) => {
      const existing = store.get(id);
      if (!existing) throw new Error(`Record to update not found: template ${id}`);
      const updated = { ...existing, ...updates };
      store.set(id, updated);
      return updated;
    },
  };
  return { store, service: new ContestConfigTemplateService(repository) };
}

describe('ContestConfigTemplateService.listTemplates', () => {
  it('lists active templates for an event type together with the any-event-type ones, in sort order', async () => {
    const { service } = templateStore([
      template({ id: 'major', eventType: 'MAJOR', sortOrder: 2, name: 'Major special' }),
      template({ id: 'any', eventType: null, sortOrder: 1 }),
      template({ id: 'other', eventType: 'OPPOSITE_FIELD', sortOrder: 0 }),
      template({ id: 'retired', eventType: 'MAJOR', active: false }),
    ]);

    const listed = await service.listTemplates({ sport: Sport.GOLF, eventType: 'MAJOR', active: true });

    expect(listed.map((row) => row.id)).toEqual(['any', 'major']);
    expect(listed[0].configuration).toEqual({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 });
  });
});

describe('ContestConfigTemplateService.listTemplates by sport league (#624)', () => {
  it('lists a league\'s own templates with the sport-wide ones, leaves out another league\'s, and echoes each sportLeagueId', async () => {
    const { service } = templateStore([
      template({ id: 'sport-wide', sportLeagueId: null, sortOrder: 1 }),
      template({ id: 'lpga', sportLeagueId: 'lpga-league', sortOrder: 2 }),
      template({ id: 'pga', sportLeagueId: 'pga-league', sortOrder: 3 }),
    ]);

    const listed = await service.listTemplates({ sport: Sport.GOLF, sportLeagueId: 'lpga-league' });

    expect(listed.map((row) => [row.id, row.sportLeagueId])).toEqual([['sport-wide', null], ['lpga', 'lpga-league']]);
  });
});

describe('ContestConfigTemplateService.updateTemplate', () => {
  it('stores the changed fields and leaves the rest alone', async () => {
    const { store, service } = templateStore([template({ id: 't1' })]);

    const dto = await service.updateTemplate('t1', {
      name: 'Pick 8, count 5',
      description: 'Bigger roster',
      sortOrder: 4,
      configuration: { maxEntriesPerSquad: null, selectionType: SelectionType.TIERED, picksPerTier: 2, countedScores: 5 },
    });

    expect(store.get('t1')).toMatchObject({
      name: 'Pick 8, count 5',
      description: 'Bigger roster',
      sortOrder: 4,
      configJson: { selectionType: SelectionType.TIERED, picksPerTier: 2, countedScores: 5 },
      active: true,
      isDefault: false,
    });
    expect(dto.name).toBe('Pick 8, count 5');
  });

  it('makes a template the default and takes the default off the other template for the same event type', async () => {
    const { store, service } = templateStore([
      template({ id: 'old-default', isDefault: true }),
      template({ id: 'new-default' }),
    ]);

    await service.updateTemplate('new-default', { isDefault: true });

    expect(store.get('new-default')?.isDefault).toBe(true);
    expect(store.get('old-default')?.isDefault).toBe(false);
  });

  it('keeps the any-event-type default when a default is set for one event type', async () => {
    const { store, service } = templateStore([
      template({ id: 'any-default', eventType: null, isDefault: true }),
      template({ id: 'major', eventType: 'MAJOR' }),
    ]);

    await service.updateTemplate('major', { isDefault: true });

    expect(store.get('major')?.isDefault).toBe(true);
    expect(store.get('any-default')?.isDefault).toBe(true);
  });

  it('keeps another sport league\'s default when a default is set for one league, so each series keeps its own preset', async () => {
    const { store, service } = templateStore([
      template({ id: 'indycar-tiered', sport: Sport.AUTO_RACING, sportLeagueId: 'indycar', isDefault: true }),
      template({ id: 'nascar-tiered', sport: Sport.AUTO_RACING, sportLeagueId: 'nascar', isDefault: true }),
      template({ id: 'nascar-budget', sport: Sport.AUTO_RACING, sportLeagueId: 'nascar', selectionType: SelectionType.BUDGET_PICK }),
    ]);

    await service.updateTemplate('nascar-budget', { isDefault: true });

    expect(store.get('nascar-budget')?.isDefault).toBe(true);
    expect(store.get('nascar-tiered')?.isDefault).toBe(false);
    expect(store.get('indycar-tiered')?.isDefault).toBe(true);
  });

  it('keeps a sport league\'s default when a sport-wide default is set, and another sport\'s default too', async () => {
    const { store, service } = templateStore([
      template({ id: 'nascar-tiered', sport: Sport.AUTO_RACING, sportLeagueId: 'nascar', isDefault: true }),
      template({ id: 'golf-default', isDefault: true }),
      template({ id: 'auto-sport-wide', sport: Sport.AUTO_RACING }),
    ]);

    await service.updateTemplate('auto-sport-wide', { isDefault: true });

    expect(store.get('auto-sport-wide')?.isDefault).toBe(true);
    expect(store.get('nascar-tiered')?.isDefault).toBe(true);
    expect(store.get('golf-default')?.isDefault).toBe(true);
  });

  it('takes the default off a template that is deactivated, even when the request also asks for default', async () => {
    const { store, service } = templateStore([template({ id: 't1', isDefault: true })]);

    await service.updateTemplate('t1', { active: false, isDefault: true });

    expect(store.get('t1')).toMatchObject({ active: false, isDefault: false });
  });

  it('refuses to make an inactive template the default, since commissioners never see it', async () => {
    const { store, service } = templateStore([
      template({ id: 'live-default', isDefault: true }),
      template({ id: 'retired', active: false }),
    ]);

    await service.updateTemplate('retired', { isDefault: true });

    expect(store.get('retired')?.isDefault).toBe(false);
    expect(store.get('live-default')?.isDefault).toBe(true);
  });

  it('answers ContestConfigTemplateNotFoundError for an unknown template', async () => {
    const { service } = templateStore([]);

    await expect(service.updateTemplate('missing', { name: 'x' }))
      .rejects.toBeInstanceOf(ContestConfigTemplateNotFoundError);
  });
});
