/**
 * Scoring Config Validation Tests — validates that every scoring template
 * in the registry passes the ScoringConfigSchema Zod validation.
 *
 * This catches silent drift where a template's structure diverges from the
 * schema (e.g., new required fields, changed enum values, typos in field names).
 */

import {
  ScoringConfigSchema,
  DNFHandling,
  CountingMethod,
} from '@poolmaster/shared/domain/scoring-config';
import { SCORING_TEMPLATES } from '../../../packages/core-api/src/modules/scoring/templates/registry';

// ========================================================================
// Tests
// ========================================================================

describe('Scoring config validation — all templates pass Zod schema', () => {
  const templateEntries = Object.entries(SCORING_TEMPLATES);

  it('registry is not empty', () => {
    expect(templateEntries.length).toBeGreaterThan(0);
  });

  it.each(templateEntries)(
    '%s passes ScoringConfigSchema.parse() without throwing',
    (_key, config) => {
      expect(() => ScoringConfigSchema.parse(config)).not.toThrow();
    },
  );

  it.each(templateEntries)(
    '%s has a non-empty sport field',
    (_key, config) => {
      expect(config.sport).toBeTruthy();
      expect(config.sport.length).toBeGreaterThan(0);
    },
  );

  it.each(templateEntries)(
    '%s has a valid dnf_handling value',
    (_key, config) => {
      const validValues = DNFHandling.options;
      // dnf_handling has a default of 'ZERO', so it may be undefined in the raw config
      // but after parsing it will always be present
      const parsed = ScoringConfigSchema.parse(config);
      expect(validValues).toContain(parsed.dnf_handling);
    },
  );

  it.each(templateEntries)(
    '%s has a valid counting_method value',
    (_key, config) => {
      const validValues = CountingMethod.options;
      // counting_method has a default of 'ALL', so it may be undefined in the raw config
      // but after parsing it will always be present
      const parsed = ScoringConfigSchema.parse(config);
      expect(validValues).toContain(parsed.counting_method);
    },
  );

  it('all templates produce consistent parsed output', () => {
    for (const [key, config] of templateEntries) {
      const parsed = ScoringConfigSchema.parse(config);
      // Parsed config must retain the sport and scoring_type
      expect(parsed.sport).toBe(config.sport);
      expect(parsed.scoring_type).toBe(config.scoring_type);
    }
  });

  it('all templates have arrays for rule fields (no undefined)', () => {
    for (const [_key, config] of templateEntries) {
      const parsed = ScoringConfigSchema.parse(config);
      expect(Array.isArray(parsed.stat_rules)).toBe(true);
      expect(Array.isArray(parsed.position_rules)).toBe(true);
      expect(Array.isArray(parsed.bonus_rules)).toBe(true);
      expect(Array.isArray(parsed.penalty_rules)).toBe(true);
      expect(Array.isArray(parsed.multiplier_rules)).toBe(true);
      expect(Array.isArray(parsed.bracket_round_rules)).toBe(true);
      expect(Array.isArray(parsed.special_slots)).toBe(true);
    }
  });

  it('dnf_handling defaults to ZERO when not explicitly set', () => {
    for (const [_key, config] of templateEntries) {
      const parsed = ScoringConfigSchema.parse(config);
      if (config.dnf_handling === undefined) {
        expect(parsed.dnf_handling).toBe('ZERO');
      }
    }
  });

  it('counting_method defaults to ALL when not explicitly set', () => {
    for (const [_key, config] of templateEntries) {
      const parsed = ScoringConfigSchema.parse(config);
      if (config.counting_method === undefined) {
        expect(parsed.counting_method).toBe('ALL');
      }
    }
  });

  it('templates with BEST_N counting_method have best_n set', () => {
    for (const [key, config] of templateEntries) {
      if (config.counting_method === 'BEST_N') {
        expect(config.best_n).toBeDefined();
        expect(config.best_n).toBeGreaterThan(0);
      }
    }
  });

  it('templates with lower_is_better=true use STROKE_PLAY scoring_type', () => {
    for (const [_key, config] of templateEntries) {
      if (config.lower_is_better === true) {
        expect(config.scoring_type).toBe('STROKE_PLAY');
      }
    }
  });
});
