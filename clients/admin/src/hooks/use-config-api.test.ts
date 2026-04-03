import { describe, it, expect } from 'vitest';
import {
  mapAdminScoringTemplateToUiTemplate,
  mapAdminSelectionTemplateToUiTemplate,
} from './use-config-api';

describe('config template mapping helpers', () => {
  it('maps scoring templates into the admin UI model', () => {
    expect(
      mapAdminScoringTemplateToUiTemplate({
        id: 'nfl-standard',
        sport: 'NFL',
        name: 'NFL Standard',
        description: 'Standard scoring',
        config: { passingYards: 1 },
        updatedAt: '2026-04-02T12:00:00.000Z',
      }),
    ).toEqual({
      id: 'nfl-standard',
      name: 'NFL Standard',
      sport: 'NFL',
      type: 'Scoring',
      description: 'Standard scoring',
      lastModified: '2026-04-02T12:00:00.000Z',
      config: { passingYards: 1 },
    });
  });

  it('maps selection templates into the admin UI model', () => {
    expect(
      mapAdminSelectionTemplateToUiTemplate({
        id: 'nfl-snake',
        name: 'NFL Snake',
        sport: 'NFL',
        description: 'Snake draft',
        contestType: 'SEASON_LONG',
        selectionType: 'SNAKE_DRAFT',
        config: { rounds: 15 },
        updatedAt: '2026-04-02T12:00:00.000Z',
      }),
    ).toEqual({
      id: 'nfl-snake',
      name: 'NFL Snake',
      sport: 'NFL',
      type: 'Selection',
      description: 'Snake draft',
      lastModified: '2026-04-02T12:00:00.000Z',
      contestType: 'SEASON_LONG',
      selectionType: 'SNAKE_DRAFT',
      config: { rounds: 15 },
    });
  });
});
