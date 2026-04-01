/**
 * Template Consistency Tests — validates that scoring and selection templates
 * reference valid enum values from the shared domain.
 *
 * Catches drift when enums change but template files are not updated,
 * or when templates reference removed values like SEASON_LONG.
 */

import {
  Sport,
  SelectionType,
  ContestType,
  ScoringType,
} from '@poolmaster/shared/domain';
import { SCORING_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/registry';
import { SELECTION_TEMPLATES } from '../../../packages/core-api/src/modules/drafts/templates/selection-templates';

// --- Helpers ---

function enumValues<T extends Record<string, string>>(obj: T): string[] {
  return Object.values(obj);
}

// ========================================================================
// Scoring Template Tests
// ========================================================================

describe('Scoring template consistency', () => {
  const templateEntries = Object.entries(SCORING_TEMPLATES);

  it('registry is not empty', () => {
    expect(templateEntries.length).toBeGreaterThan(0);
  });

  it.each(templateEntries)(
    '%s has a valid Sport enum value for sport field',
    (_key, config) => {
      expect(enumValues(Sport)).toContain(config.sport);
    },
  );

  it.each(templateEntries)(
    '%s has a valid ScoringType for scoring_type field',
    (_key, config) => {
      const validTypes = ScoringType.options;
      expect(validTypes).toContain(config.scoring_type);
    },
  );

  it.each(templateEntries)(
    '%s has a non-empty sport field',
    (_key, config) => {
      expect(config.sport).toBeTruthy();
      expect(config.sport.length).toBeGreaterThan(0);
    },
  );

  it('no scoring template uses a sport value outside the Sport enum', () => {
    const validSports = enumValues(Sport);
    const invalidTemplates = templateEntries.filter(
      ([, config]) => !validSports.includes(config.sport),
    );
    expect(invalidTemplates.map(([key]) => key)).toEqual([]);
  });
});

// ========================================================================
// Selection Template Tests
// ========================================================================

describe('Selection template consistency', () => {
  it('selection templates array is not empty', () => {
    expect(SELECTION_TEMPLATES.length).toBeGreaterThan(0);
  });

  it.each(SELECTION_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s has a valid Sport enum value',
    (_id, template) => {
      expect(enumValues(Sport)).toContain(template.sport);
    },
  );

  it.each(SELECTION_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s has a valid SelectionType enum value',
    (_id, template) => {
      expect(enumValues(SelectionType)).toContain(template.selectionType);
    },
  );

  it.each(SELECTION_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s has a valid ContestType enum value (should be SINGLE_EVENT)',
    (_id, template) => {
      expect(enumValues(ContestType)).toContain(template.contestType);
    },
  );

  it('no selection template uses SEASON_LONG', () => {
    const seasonLongTemplates = SELECTION_TEMPLATES.filter(
      (t) => t.contestType === 'SEASON_LONG',
    );
    expect(seasonLongTemplates.map((t) => t.id)).toEqual([]);
  });

  it('all selection templates use SINGLE_EVENT contest type', () => {
    for (const template of SELECTION_TEMPLATES) {
      expect(template.contestType).toBe('SINGLE_EVENT');
    }
  });

  it('every selection template has a non-empty id', () => {
    for (const template of SELECTION_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.id.length).toBeGreaterThan(0);
    }
  });

  it('every selection template has a non-empty name', () => {
    for (const template of SELECTION_TEMPLATES) {
      expect(template.name).toBeTruthy();
      expect(template.name.length).toBeGreaterThan(0);
    }
  });

  it('selection template ids are unique', () => {
    const ids = SELECTION_TEMPLATES.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
