import type { FastifyBaseLogger } from 'fastify';
import type { ContestConfigTemplateRepository } from '@poolmaster/shared/db';
import type {
  UpdateContestConfigTemplateRequest,
  ContestConfigTemplateDto,
  ListContestConfigTemplatesQuery,
} from '@poolmaster/shared/dto';
import type { ContestConfigTemplate } from '@poolmaster/shared/domain';
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

/** A template's rules must be its own selection type's shape (#93). */
export class ContestConfigTemplateRulesMismatchError extends Error {
  constructor(templateSelectionType: string, rulesSelectionType: string) {
    super(`This template is ${templateSelectionType}, so its configuration must be ${templateSelectionType} rules, not ${rulesSelectionType}.`);
    this.name = 'ContestConfigTemplateRulesMismatchError';
  }
}

/**
 * `ContestConfigTemplate` is global under A11: any signed-in user reads it, only a root admin
 * writes it. One read for the commissioner's create flow and the root-admin screens alike.
 */
export class ContestConfigTemplateService {
  constructor(
    private readonly repository: ContestConfigTemplateRepository,
    private readonly logger: Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error' | 'fatal'> = createNoopLogger(),
  ) {}

  async listTemplates(
    query: ListContestConfigTemplatesQuery,
  ): Promise<ContestConfigTemplateDto[]> {
    this.logger.debug({
      sport: query.sport ?? null,
      contestFormat: query.contestFormat ?? null,
      eventType: query.eventType ?? null,
      active: query.active ?? null,
    }, 'contest template list start');

    const templates = await this.repository.list({
      sport: query.sport,
      contestFormat: query.contestFormat,
      eventType: query.eventType,
      active: query.active,
    });

    this.logger.info({
      templateCount: templates.length,
    }, 'contest template list completed');
    return templates.map(mapContestConfigTemplateDto);
  }

  async updateTemplate(
    templateId: string,
    input: UpdateContestConfigTemplateRequest,
  ): Promise<ContestConfigTemplateDto> {
    this.logger.debug({
      templateId,
      keys: Object.keys(input),
    }, 'contest template admin update start');

    const existing = await this.repository.findById(templateId);
    if (!existing) {
      throw new ContestConfigTemplateNotFoundError(templateId);
    }
    if (input.configuration && input.configuration.selectionType !== existing.selectionType) {
      this.logger.warn({
        templateId,
        templateSelectionType: existing.selectionType,
        rulesSelectionType: input.configuration.selectionType,
      }, 'contest template admin update refused for rules of another selection type');
      throw new ContestConfigTemplateRulesMismatchError(existing.selectionType, input.configuration.selectionType);
    }

    // Only an active template can be the default: deactivating one takes its default off, and
    // an inactive one cannot take the default from an active one.
    const nextIsDefault = (input.active ?? existing.active)
      ? input.isDefault ?? existing.isDefault
      : false;

    const updates: Partial<ContestConfigTemplate> = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
      ...(input.active !== undefined && { active: input.active }),
      ...(input.configuration !== undefined && { configJson: input.configuration }),
      isDefault: nextIsDefault,
    };

    if (nextIsDefault) {
      // The default is unique per exact event type. `list` also returns any-event-type
      // templates for an event type, so the scope is narrowed back to the exact match here.
      const scopeTemplates = (await this.repository.list({
        sport: existing.sport,
        contestFormat: existing.contestFormat,
        eventType: existing.eventType ?? null,
      })).filter((template) => (template.eventType ?? null) === (existing.eventType ?? null));

      await Promise.all(
        scopeTemplates
          .filter((template) => template.id !== templateId && template.isDefault)
          .map((template) => this.repository.update(template.id, { isDefault: false })),
      );
    }

    const updated = await this.repository.update(templateId, updates);

    this.logger.info({
      templateId,
      templateKey: updated.templateKey,
      isDefault: updated.isDefault,
      active: updated.active,
    }, 'contest template admin update completed');
    return mapContestConfigTemplateDto(updated);
  }
}
