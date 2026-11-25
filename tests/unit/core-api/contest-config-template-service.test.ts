/**
 * Contest templates: the commissioner's list and the root admin's edits, against a stateful
 * template store that filters the way the Prisma adapter does. Tests assert the stored rows.
 */
import type { ContestConfigTemplateRepository } from '@poolmaster/shared/db';
import type { ContestConfigTemplate, ContestTemplateSlot } from '@poolmaster/shared/domain';
import { ContestFormat, LeaguePhase, MatchFormat, SelectionType, SlotKind, TemplateCoverageMode } from '@poolmaster/shared/domain';
import {
  ContestConfigTemplateCoverageError,
  ContestConfigTemplateNotFoundError,
  ContestConfigTemplateRulesMismatchError,
  ContestConfigTemplateService,
} from '../../../packages/core-api/src/modules/contest-config-templates/service';

/** A slot definition of the PGA TOUR's regular season: a tournament of its own. */
function slot(overrides: Partial<ContestTemplateSlot> & { id: string }): ContestTemplateSlot {
  return {
    key: overrides.id.toUpperCase(), name: null, slotKind: SlotKind.TOURNAMENT, weekNumber: null,
    sportLeagueCompetitionId: 'pga-regular', competitionCode: 'REGULAR', competitionOrderIndex: 1, phase: LeaguePhase.REGULAR, matchFormat: MatchFormat.FIELD,
    ...overrides,
  };
}

function template(overrides: Partial<ContestConfigTemplate>): ContestConfigTemplate {
  return {
    id: 'template',
    sportLeagueId: 'pga-league',
    coverageMode: TemplateCoverageMode.ONE_SLOT,
    slots: [slot({ id: 'masters' })],
    contestFormat: ContestFormat.ROSTER,
    selectionType: SelectionType.TIERED,
    templateKey: 'golf-tiered',
    name: 'Pick 6, count 4',
    description: 'Tiered golf',
    sortOrder: 1,
    isDefault: false,
    active: true,
    configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
    schemaVersion: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/**
 * Mirrors PrismaContestConfigTemplateRepository: the list matches a template covering any of the
 * asked slot definitions, and a sport league only its own; an update takes the default off the
 * other template of its sport league and selection type, and replaces the slots it is given.
 * `definitions` are the slot definitions each sport league has.
 */
function templateStore(rows: ContestConfigTemplate[], definitions: Record<string, ContestTemplateSlot[]> = {}) {
  const store = new Map(rows.map((row) => [row.id, row]));
  const repository: ContestConfigTemplateRepository = {
    findById: async (id) => store.get(id) ?? null,
    list: async (input = {}) => [...store.values()]
      // No format filter: every template is ROSTER while that enum has one member.
      .filter((row) =>
        (input.slotDefinitionIds === undefined || row.slots.some((covered) => input.slotDefinitionIds?.includes(covered.id) === true))
        && (input.sportLeagueId === undefined || row.sportLeagueId === input.sportLeagueId)
        && (input.active === undefined || row.active === input.active))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)),
    update: async (id, { slotDefinitionIds, ...updates }) => {
      const existing = store.get(id);
      if (!existing) throw new Error(`Record to update not found: template ${id}`);
      if (updates.isDefault === true) {
        for (const other of store.values()) {
          if (other.id !== id && other.sportLeagueId === existing.sportLeagueId && other.selectionType === existing.selectionType) {
            store.set(other.id, { ...other, isDefault: false });
          }
        }
      }
      const slots = slotDefinitionIds === undefined
        ? existing.slots
        : (definitions[existing.sportLeagueId] ?? []).filter((definition) => slotDefinitionIds.includes(definition.id));
      const updated = { ...existing, ...updates, slots };
      store.set(id, updated);
      return updated;
    },
    findSlotDefinitions: async (sportLeagueId, ids) => (definitions[sportLeagueId] ?? []).filter((definition) => ids.includes(definition.id)),
  };
  return { store, service: new ContestConfigTemplateService(repository) };
}

describe('ContestConfigTemplateService.listTemplates', () => {
  it('lists the active templates covering any of the asked slot definitions, in sort order, each with its coverage and slots', async () => {
    const masters = slot({ id: 'masters' });
    const { service } = templateStore([
      template({ id: 'masters-special', slots: [masters], sortOrder: 2, name: 'Masters special' }),
      template({ id: 'every-tournament', slots: [slot({ id: 'open' }), masters], sortOrder: 1 }),
      template({ id: 'other', slots: [slot({ id: 'open' })], sortOrder: 0 }),
      template({ id: 'retired', slots: [masters], active: false }),
    ]);

    const listed = await service.listTemplates({ slotDefinitionIds: ['masters'], active: true });

    expect(listed.map((row) => row.id)).toEqual(['every-tournament', 'masters-special']);
    expect(listed[0]).toMatchObject({ coverageMode: TemplateCoverageMode.ONE_SLOT, slots: [{ id: 'open' }, { id: 'masters' }] });
    expect(listed[0].configuration).toEqual({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 });
  });
});

describe('ContestConfigTemplateService.listTemplates by sport league (#624)', () => {
  it('lists only a league\'s own templates, leaves out another league\'s, and echoes each sportLeagueId', async () => {
    const { service } = templateStore([
      template({ id: 'lpga', sportLeagueId: 'lpga-league', sortOrder: 2 }),
      template({ id: 'pga', sportLeagueId: 'pga-league', sortOrder: 3 }),
    ]);

    const listed = await service.listTemplates({ sportLeagueId: 'lpga-league' });

    expect(listed.map((row) => [row.id, row.sportLeagueId])).toEqual([['lpga', 'lpga-league']]);
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

  it('makes a template the default and takes the default off the other template of its sport league and selection type', async () => {
    const { store, service } = templateStore([
      template({ id: 'old-default', isDefault: true }),
      template({ id: 'new-default' }),
    ]);

    await service.updateTemplate('new-default', { isDefault: true });

    expect(store.get('new-default')?.isDefault).toBe(true);
    expect(store.get('old-default')?.isDefault).toBe(false);
  });

  it('keeps another selection type\'s default when a default is set, so every way of picking starts on its own default', async () => {
    const { store, service } = templateStore([
      template({ id: 'tiered-default', selectionType: SelectionType.TIERED, isDefault: true }),
      template({
        id: 'budget',
        selectionType: SelectionType.BUDGET_PICK,
        configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 4 },
      }),
    ]);

    await service.updateTemplate('budget', { isDefault: true });

    expect(store.get('budget')?.isDefault).toBe(true);
    expect(store.get('tiered-default')?.isDefault).toBe(true);
  });

  it('keeps another sport league\'s default when a default is set for one league, so each series keeps its own preset', async () => {
    const { store, service } = templateStore([
      template({ id: 'indycar-tiered', sportLeagueId: 'indycar', isDefault: true }),
      template({ id: 'nascar-tiered', sportLeagueId: 'nascar', isDefault: true }),
      template({ id: 'nascar-tiered-big', sportLeagueId: 'nascar' }),
    ]);

    await service.updateTemplate('nascar-tiered-big', { isDefault: true });

    expect(store.get('nascar-tiered-big')?.isDefault).toBe(true);
    expect(store.get('nascar-tiered')?.isDefault).toBe(false);
    expect(store.get('indycar-tiered')?.isDefault).toBe(true);
  });

  it('keeps the LPGA Tour\'s default when PGA TOUR\'s copy of the same setup family takes a new default, so one league\'s change leaves the other\'s and another selection type\'s alone', async () => {
    const { store, service } = templateStore([
      template({ id: 'pga-pick-6', templateKey: 'golf-tiered-pick-6', sportLeagueId: 'pga-league', isDefault: true }),
      template({ id: 'pga-pick-12', templateKey: 'golf-tiered-pick-12', sportLeagueId: 'pga-league' }),
      template({ id: 'lpga-pick-6', templateKey: 'golf-tiered-pick-6', sportLeagueId: 'lpga-league', isDefault: true }),
      template({ id: 'nascar-tiered', sportLeagueId: 'nascar', isDefault: true }),
      template({ id: 'pga-budget', sportLeagueId: 'pga-league', selectionType: SelectionType.BUDGET_PICK, isDefault: true }),
    ]);

    await service.updateTemplate('pga-pick-12', { isDefault: true });

    expect(store.get('pga-pick-12')?.isDefault).toBe(true);
    expect(store.get('pga-pick-6')?.isDefault).toBe(false);
    expect(store.get('lpga-pick-6')?.isDefault).toBe(true);
    expect(store.get('nascar-tiered')?.isDefault).toBe(true);
    expect(store.get('pga-budget')?.isDefault).toBe(true);
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

  it('refuses rules of another selection type with ContestConfigTemplateRulesMismatchError, naming both, and stores nothing', async () => {
    const { store, service } = templateStore([template({ id: 't1' })]);
    const budgetRules = { selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 4 } as unknown as ContestConfigTemplate['configJson'];

    const failure = service.updateTemplate('t1', { configuration: budgetRules });

    await expect(failure).rejects.toBeInstanceOf(ContestConfigTemplateRulesMismatchError);
    await expect(failure).rejects.toThrow('This template is TIERED, so its configuration must be TIERED rules, not BUDGET_PICK.');
    expect(store.get('t1')?.configJson).toEqual(template({}).configJson);
  });

  describe('the slots it covers (#2010)', () => {
    const regular = (id: string, overrides: Partial<ContestTemplateSlot> = {}) => slot({ id, ...overrides });
    const week = (id: string, weekNumber: number) => slot({ id, slotKind: SlotKind.WEEK, weekNumber, matchFormat: MatchFormat.HEAD_TO_HEAD, sportLeagueCompetitionId: 'nfl-regular' });
    const playoff = (id: string, slotKind: SlotKind) => slot({ id, slotKind, phase: LeaguePhase.POSTSEASON, matchFormat: MatchFormat.HEAD_TO_HEAD, sportLeagueCompetitionId: 'nfl-post', competitionCode: 'POSTSEASON' });
    const nfl = [week('week-1', 1), week('week-2', 2), playoff('wild-card', SlotKind.ROUND_OF_16), playoff('final', SlotKind.FINAL)];

    it('replaces the slots a template covers and its coverage mode with the ones the edit lists', async () => {
      const { store, service } = templateStore([template({ id: 'pickem', sportLeagueId: 'nfl', slots: [nfl[0]] })], { nfl });

      const dto = await service.updateTemplate('pickem', { coverageMode: TemplateCoverageMode.FROM_SLOT, slotDefinitionIds: ['week-1', 'week-2'] });

      expect(store.get('pickem')).toMatchObject({ coverageMode: TemplateCoverageMode.FROM_SLOT, slots: [{ id: 'week-1' }, { id: 'week-2' }] });
      expect(dto.slots.map((covered) => covered.id)).toEqual(['week-1', 'week-2']);
    });

    it('refuses a slot definition of another sport league with CONTEST_CONFIG_TEMPLATE_UNKNOWN_SLOT and stores nothing', async () => {
      const { store, service } = templateStore([template({ id: 't1' })], { 'pga-league': [regular('masters')], nfl });

      const failure = service.updateTemplate('t1', { slotDefinitionIds: ['masters', 'week-1'] });

      await expect(failure).rejects.toBeInstanceOf(ContestConfigTemplateCoverageError);
      await expect(failure).rejects.toMatchObject({ code: 'CONTEST_CONFIG_TEMPLATE_UNKNOWN_SLOT' });
      expect(store.get('t1')?.slots.map((covered) => covered.id)).toEqual(['masters']);
    });

    it('refuses ALL_LISTED over two tournaments with CONTEST_CONFIG_TEMPLATE_ALL_LISTED_SPANS_EVENTS, since each tournament is an event of its own', async () => {
      const definitions = { 'pga-league': [regular('masters'), regular('open')] };
      const { store, service } = templateStore([template({ id: 't1' })], definitions);

      const failure = service.updateTemplate('t1', { coverageMode: TemplateCoverageMode.ALL_LISTED, slotDefinitionIds: ['masters', 'open'] });

      await expect(failure).rejects.toMatchObject({ code: 'CONTEST_CONFIG_TEMPLATE_ALL_LISTED_SPANS_EVENTS' });
      expect(store.get('t1')?.coverageMode).toBe(TemplateCoverageMode.ONE_SLOT);
    });

    it('refuses switching a ONE_SLOT template listing two competitions to ALL_LISTED or FROM_SLOT with CONTEST_CONFIG_TEMPLATE_SPANS_COMPETITIONS, checking the slots it keeps, and stores nothing', async () => {
      const { store, service } = templateStore([template({ id: 'nfl-squares', sportLeagueId: 'nfl', slots: [nfl[1], nfl[3]] })], { nfl });

      await expect(service.updateTemplate('nfl-squares', { coverageMode: TemplateCoverageMode.ALL_LISTED }))
        .rejects.toMatchObject({ code: 'CONTEST_CONFIG_TEMPLATE_SPANS_COMPETITIONS' });
      await expect(service.updateTemplate('nfl-squares', { coverageMode: TemplateCoverageMode.FROM_SLOT }))
        .rejects.toMatchObject({ code: 'CONTEST_CONFIG_TEMPLATE_SPANS_COMPETITIONS' });
      expect(store.get('nfl-squares')?.coverageMode).toBe(TemplateCoverageMode.ONE_SLOT);
    });

    it('refuses a FROM_SLOT edit listing a regular-season week and a playoff round with CONTEST_CONFIG_TEMPLATE_SPANS_COMPETITIONS, and accepts one over the weeks alone', async () => {
      const { store, service } = templateStore([template({ id: 'survivor', sportLeagueId: 'nfl', coverageMode: TemplateCoverageMode.FROM_SLOT, slots: [nfl[0]] })], { nfl });

      await expect(service.updateTemplate('survivor', { slotDefinitionIds: ['week-2', 'wild-card'] }))
        .rejects.toMatchObject({ code: 'CONTEST_CONFIG_TEMPLATE_SPANS_COMPETITIONS' });
      await service.updateTemplate('survivor', { slotDefinitionIds: ['week-1', 'week-2'] });
      expect(store.get('survivor')?.slots.map((covered) => covered.id)).toEqual(['week-1', 'week-2']);
    });

    it('accepts a ONE_SLOT template listing a week and a playoff round, as each of its contests covers one slot', async () => {
      const { store, service } = templateStore([template({ id: 'nfl-squares', sportLeagueId: 'nfl', slots: [nfl[0]] })], { nfl });

      await service.updateTemplate('nfl-squares', { slotDefinitionIds: ['week-1', 'final'] });

      expect(store.get('nfl-squares')?.slots.map((covered) => covered.id)).toEqual(['week-1', 'final']);
    });

    it('accepts ALL_LISTED over one competition\'s knockout rounds, the slots one event plays', async () => {
      const { store, service } = templateStore([template({ id: 'playoffs', sportLeagueId: 'nfl', slots: [nfl[2]] })], { nfl });

      await service.updateTemplate('playoffs', { coverageMode: TemplateCoverageMode.ALL_LISTED, slotDefinitionIds: ['wild-card', 'final'] });

      expect(store.get('playoffs')).toMatchObject({ coverageMode: TemplateCoverageMode.ALL_LISTED, slots: [{ id: 'wild-card' }, { id: 'final' }] });
    });

    it('refuses a bracket listing a regular-season week with CONTEST_CONFIG_TEMPLATE_BRACKET_OUTSIDE_KNOCKOUT, where a side need not advance', async () => {
      const bracket = template({
        id: 'bracket', sportLeagueId: 'nfl', selectionType: SelectionType.BRACKET, coverageMode: TemplateCoverageMode.ALL_LISTED, slots: [nfl[2], nfl[3]],
        configJson: { selectionType: SelectionType.BRACKET } as unknown as ContestConfigTemplate['configJson'],
      });
      const { store, service } = templateStore([bracket], { nfl });

      await expect(service.updateTemplate('bracket', { coverageMode: TemplateCoverageMode.ONE_SLOT, slotDefinitionIds: ['week-2', 'wild-card'] }))
        .rejects.toMatchObject({ code: 'CONTEST_CONFIG_TEMPLATE_BRACKET_OUTSIDE_KNOCKOUT' });
      expect(store.get('bracket')?.slots.map((covered) => covered.id)).toEqual(['wild-card', 'final']);
    });
  });
});
