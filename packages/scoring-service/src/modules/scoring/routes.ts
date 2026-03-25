/**
 * Scoring template library routes — commissioners browse and select templates.
 */

import type { FastifyInstance } from 'fastify';
import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import { SCORING_TEMPLATES, getTemplate, listTemplates } from '../../templates/registry';
import { validateStatKeys } from '../../engine/stat-schemas';

export async function scoringRoutes(app: FastifyInstance): Promise<void> {
  /** List all available scoring templates. */
  app.get('/scoring/templates', async () => {
    return {
      templates: listTemplates(),
    };
  });

  /** Get a specific template by key. Returns a mutable ScoringConfig. */
  app.get<{ Params: { key: string } }>('/scoring/templates/:key', async (request, reply) => {
    const { key } = request.params;
    const template = getTemplate(key);

    if (!template) {
      return reply.status(404).send({ error: `Template "${key}" not found` });
    }

    return {
      key,
      config: template,
    };
  });

  /** Validate a ScoringConfig — parse with Zod and check stat keys. */
  app.post('/scoring/config/validate', async (request, reply) => {
    const parseResult = ScoringConfigSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        valid: false,
        errors: parseResult.error.issues,
      });
    }

    const statErrors = validateStatKeys(parseResult.data);

    return {
      valid: statErrors.length === 0,
      config: parseResult.data,
      warnings: statErrors,
    };
  });
}
