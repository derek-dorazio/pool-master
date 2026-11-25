import type { FastifyBaseLogger } from 'fastify';
import type { ContestConfigTemplateRepository, ContestConfigTemplateUpdate } from '@poolmaster/shared/db';
import type {
  UpdateContestConfigTemplateRequest,
  ContestConfigTemplateDto,
  ListContestConfigTemplatesQuery,
} from '@poolmaster/shared/dto';
import { templateCoverageProblem, TemplateCoverageProblem, type ContestConfigTemplate } from '@poolmaster/shared/domain';
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
 * The slots a template edit lists do not fit it (#2010): a definition not of its sport league, or
 * a coverage the listed slots refuse (`templateCoverageProblem`).
 */
export class ContestConfigTemplateCoverageError extends Error {
  constructor(
    readonly code: 'CONTEST_CONFIG_TEMPLATE_UNKNOWN_SLOT' | 'CONTEST_CONFIG_TEMPLATE_ALL_LISTED_SPANS_EVENTS' | 'CONTEST_CONFIG_TEMPLATE_BRACKET_OUTSIDE_KNOCKOUT',
    message: string,
  ) {
    super(message);
    this.name = 'ContestConfigTemplateCoverageError';
  }
}

const COVERAGE_PROBLEM_ERRORS: Record<TemplateCoverageProblem, { code: ContestConfigTemplateCoverageError['code']; message: string }> = {
  [TemplateCoverageProblem.ALL_LISTED_SPANS_EVENTS]: {
    code: 'CONTEST_CONFIG_TEMPLATE_ALL_LISTED_SPANS_EVENTS',
    message: 'A template covering all of its slots must list one event\'s slots: one phase, and a tournament on its own.',
  },
  [TemplateCoverageProblem.BRACKET_OUTSIDE_KNOCKOUT]: {
    code: 'CONTEST_CONFIG_TEMPLATE_BRACKET_OUTSIDE_KNOCKOUT',
    message: 'A bracket template may list only knockout slots, where one side always advances.',
  },
};

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
      sportLeagueId: query.sportLeagueId ?? null,
      slotDefinitionCount: query.slotDefinitionIds?.length ?? null,
      active: query.active ?? null,
    }, 'contest template list start');

    const templates = await this.repository.list({
      sportLeagueId: query.sportLeagueId,
      slotDefinitionIds: query.slotDefinitionIds,
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

    await this.assertCoverageFits(existing, input);

    // Only an active template can be the default: deactivating one takes its default off, and
    // an inactive one cannot take the default from an active one. Taking the default unsets the
    // one its sport league and selection type had, in the same write (#2010).
    const nextIsDefault = (input.active ?? existing.active)
      ? input.isDefault ?? existing.isDefault
      : false;

    const updates: ContestConfigTemplateUpdate = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
      ...(input.active !== undefined && { active: input.active }),
      ...(input.configuration !== undefined && { configJson: input.configuration }),
      ...(input.coverageMode !== undefined && { coverageMode: input.coverageMode }),
      ...(input.slotDefinitionIds !== undefined && { slotDefinitionIds: input.slotDefinitionIds }),
      isDefault: nextIsDefault,
    };

    const updated = await this.repository.update(templateId, updates);

    this.logger.info({
      templateId,
      templateKey: updated.templateKey,
      isDefault: updated.isDefault,
      active: updated.active,
    }, 'contest template admin update completed');
    return mapContestConfigTemplateDto(updated);
  }

  /**
   * Refuses an edit whose slots do not fit (#2010): every listed definition its own sport league's,
   * and the listed slots fitting the coverage mode and the selection type. An edit of neither is
   * checked too, so a template already out of line cannot be saved again as it is.
   */
  private async assertCoverageFits(existing: ContestConfigTemplate, input: UpdateContestConfigTemplateRequest): Promise<void> {
    const slots = input.slotDefinitionIds === undefined
      ? existing.slots
      : await this.repository.findSlotDefinitions(existing.sportLeagueId, input.slotDefinitionIds);
    if (input.slotDefinitionIds !== undefined && slots.length !== new Set(input.slotDefinitionIds).size) {
      this.logger.warn({ templateId: existing.id, asked: input.slotDefinitionIds.length, found: slots.length }, 'contest template admin update refused for a slot not of its sport league');
      throw new ContestConfigTemplateCoverageError('CONTEST_CONFIG_TEMPLATE_UNKNOWN_SLOT', 'Every slot a template lists must be one of its own sport league\'s.');
    }
    const problem = templateCoverageProblem({ coverageMode: input.coverageMode ?? existing.coverageMode, selectionType: existing.selectionType }, slots);
    if (problem !== null) {
      this.logger.warn({ templateId: existing.id, problem }, 'contest template admin update refused for slots that do not fit');
      const { code, message } = COVERAGE_PROBLEM_ERRORS[problem];
      throw new ContestConfigTemplateCoverageError(code, message);
    }
  }
}
