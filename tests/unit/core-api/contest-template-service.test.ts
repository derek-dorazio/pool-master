import {
  ContestTemplateService,
  TemplateNotFoundError,
  TemplateOperationError,
} from '../../../packages/core-api/src/modules/contests/template-service';
import type { ContestTemplateRepository } from '@poolmaster/shared/db';
import { ContestType } from '@poolmaster/shared/domain';
import { buildContestTemplate } from '../../factories';

function createMockTemplateRepo(
  overrides: Partial<ContestTemplateRepository> = {},
): ContestTemplateRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByLeague: jest.fn().mockResolvedValue([]),
    findPlatformTemplates: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-template-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      ...buildContestTemplate({ id }),
      ...updates,
    })),
    delete: jest.fn().mockResolvedValue(undefined),
    incrementUsage: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ContestTemplateService', () => {
  describe('createTemplate', () => {
    it('creates a template with isPlatformTemplate=false', async () => {
      const repo = createMockTemplateRepo();
      const service = new ContestTemplateService(repo);
      const result = await service.createTemplate({
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: 'My Golf Template',
        sport: 'GOLF' as any,
        contestType: ContestType.SINGLE_EVENT,
        draftConfig: { rounds: 5 },
        scoringConfig: { sport: 'GOLF' },
        payoutConfig: {},
        poolConfig: {},
      });
      expect(repo.create).toHaveBeenCalledTimes(1);
      const createArg = (repo.create as jest.Mock).mock.calls[0][0];
      expect(createArg.isPlatformTemplate).toBe(false);
      expect(createArg.timesUsed).toBe(0);
    });
  });

  describe('listTemplates', () => {
    it('returns league templates and platform templates combined', async () => {
      const leagueTemplates = [buildContestTemplate({ name: 'League Template' })];
      const platformTemplates = [
        buildContestTemplate({ name: 'Platform Template', isPlatformTemplate: true }),
      ];
      const repo = createMockTemplateRepo({
        findByLeague: jest.fn().mockResolvedValue(leagueTemplates),
        findPlatformTemplates: jest.fn().mockResolvedValue(platformTemplates),
      });
      const service = new ContestTemplateService(repo);
      const result = await service.listTemplates('league-1');
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('League Template');
      expect(result[1].name).toBe('Platform Template');
    });
  });

  describe('updateTemplate', () => {
    it('updates a league template', async () => {
      const template = buildContestTemplate({ id: 't-1', isPlatformTemplate: false });
      const repo = createMockTemplateRepo({
        findById: jest.fn().mockResolvedValue(template),
      });
      const service = new ContestTemplateService(repo);
      await service.updateTemplate('t-1', { name: 'Updated' });
      expect(repo.update).toHaveBeenCalledWith('t-1', { name: 'Updated' });
    });

    it('throws TemplateOperationError for platform templates', async () => {
      const template = buildContestTemplate({ id: 't-1', isPlatformTemplate: true });
      const repo = createMockTemplateRepo({
        findById: jest.fn().mockResolvedValue(template),
      });
      const service = new ContestTemplateService(repo);
      await expect(
        service.updateTemplate('t-1', { name: 'Hacked' }),
      ).rejects.toThrow(TemplateOperationError);
    });

    it('throws TemplateNotFoundError for missing template', async () => {
      const service = new ContestTemplateService(createMockTemplateRepo());
      await expect(
        service.updateTemplate('missing', { name: 'X' }),
      ).rejects.toThrow(TemplateNotFoundError);
    });
  });

  describe('deleteTemplate', () => {
    it('deletes a league template', async () => {
      const template = buildContestTemplate({ id: 't-1', isPlatformTemplate: false });
      const repo = createMockTemplateRepo({
        findById: jest.fn().mockResolvedValue(template),
      });
      const service = new ContestTemplateService(repo);
      await service.deleteTemplate('t-1');
      expect(repo.delete).toHaveBeenCalledWith('t-1');
    });

    it('throws TemplateOperationError for platform templates', async () => {
      const template = buildContestTemplate({ id: 't-1', isPlatformTemplate: true });
      const repo = createMockTemplateRepo({
        findById: jest.fn().mockResolvedValue(template),
      });
      const service = new ContestTemplateService(repo);
      await expect(service.deleteTemplate('t-1')).rejects.toThrow(TemplateOperationError);
    });

    it('throws TemplateNotFoundError for missing template', async () => {
      const service = new ContestTemplateService(createMockTemplateRepo());
      await expect(service.deleteTemplate('missing')).rejects.toThrow(TemplateNotFoundError);
    });
  });

  describe('useTemplate', () => {
    it('increments usage counter and returns the template', async () => {
      const template = buildContestTemplate({ id: 't-1', timesUsed: 3 });
      const repo = createMockTemplateRepo({
        findById: jest.fn().mockResolvedValue(template),
      });
      const service = new ContestTemplateService(repo);
      const result = await service.useTemplate('t-1');
      expect(repo.incrementUsage).toHaveBeenCalledWith('t-1');
      expect(result.id).toBe('t-1');
    });

    it('throws TemplateNotFoundError for missing template', async () => {
      const service = new ContestTemplateService(createMockTemplateRepo());
      await expect(service.useTemplate('missing')).rejects.toThrow(TemplateNotFoundError);
    });
  });
});
