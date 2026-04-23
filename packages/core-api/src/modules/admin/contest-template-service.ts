import type { FastifyBaseLogger } from 'fastify';
import type { ContestConfigTemplateRepository } from '@poolmaster/shared/db';
import type {
  AdminListContestConfigTemplatesQuery,
  AdminUpdateContestConfigTemplateRequest,
  ContestConfigTemplateDto,
} from '@poolmaster/shared/dto';
import type { ContestConfigTemplate } from '@poolmaster/shared/domain';
import { logAdminAction } from './admin-audit-service';
import { mapContestConfigTemplateDto } from '../../mappers/contest-management.mapper';

function createNoopLogger(): Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error' | 'fatal'> {
  const noop = () => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
}

export class ContestConfigTemplateNotFoundError extends Error {
  constructor(templateId: string) {
    super(`Contest config template not found: ${templateId}`);
    this.name = 'ContestConfigTemplateNotFoundError';
  }
}

export class ContestConfigTemplateUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContestConfigTemplateUpdateError';
  }
}

export class ContestTemplateAdminService {
  constructor(
    private readonly repository: ContestConfigTemplateRepository,
    private readonly logger: Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error' | 'fatal'> = createNoopLogger(),
  ) {}

  async listTemplates(
    query: AdminListContestConfigTemplatesQuery,
  ): Promise<ContestConfigTemplateDto[]> {
    this.logger.debug({
      sport: query.sport ?? null,
      contestType: query.contestType ?? null,
      active: query.active ?? null,
    }, 'contest template admin list start');

    const templates = await this.repository.list({
      sport: query.sport as ContestConfigTemplate['sport'] | undefined,
      contestType: query.contestType as ContestConfigTemplate['contestType'] | undefined,
      active: query.active,
    });

    this.logger.info({
      templateCount: templates.length,
    }, 'contest template admin list completed');
    return templates.map(mapContestConfigTemplateDto);
  }

  async updateTemplate(
    templateId: string,
    input: AdminUpdateContestConfigTemplateRequest,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<ContestConfigTemplateDto> {
    this.logger.debug({
      templateId,
      keys: Object.keys(input),
    }, 'contest template admin update start');

    const existing = await this.repository.findById(templateId);
    if (!existing) {
      throw new ContestConfigTemplateNotFoundError(templateId);
    }

    if (input.configuration && input.configuration.mode !== existing.configMode) {
      throw new ContestConfigTemplateUpdateError(
        'Updated contest template configuration must keep the same configuration mode.',
      );
    }

    const nextIsDefault = input.active === false
      ? false
      : input.isDefault ?? existing.isDefault;

    const updates: Partial<ContestConfigTemplate> = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
      ...(input.active !== undefined && { active: input.active }),
      ...(input.configuration !== undefined && { configJson: input.configuration }),
      isDefault: nextIsDefault,
    };

    if (nextIsDefault) {
      const scopeTemplates = await this.repository.list({
        sport: existing.sport,
        contestType: existing.contestType,
        eventType: existing.eventType ?? null,
      });

      await Promise.all(
        scopeTemplates
          .filter((template) => template.id !== templateId && template.isDefault)
          .map((template) => this.repository.update(template.id, { isDefault: false })),
      );
    }

    const updated = await this.repository.update(templateId, updates);

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'UPDATE_CONTEST_CONFIG_TEMPLATE',
      resourceType: 'CONTEST_CONFIG_TEMPLATE',
      resourceId: templateId,
      description: `Updated contest config template ${existing.templateKey}`,
      beforeState: mapContestConfigTemplateDto(existing) as unknown as Record<string, unknown>,
      afterState: mapContestConfigTemplateDto(updated) as unknown as Record<string, unknown>,
    });

    this.logger.info({
      templateId,
      templateKey: updated.templateKey,
      isDefault: updated.isDefault,
      active: updated.active,
    }, 'contest template admin update completed');
    return mapContestConfigTemplateDto(updated);
  }
}
