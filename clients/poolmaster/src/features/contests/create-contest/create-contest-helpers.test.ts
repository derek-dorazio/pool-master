import {
  ScoringFamily,
  SelectionType,
  Sport,
  getSportDefinition,
} from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import type { ContestConfigTemplateDto, SportEventDto } from '@/lib/api';
import {
  createContestFormSchema,
  creatableSelectionTypes,
  defaultPresetOf,
  definitionOfEvent,
  formatChoicesFor,
  isCreatableSelectionType,
  leagueStartingFormatOf,
} from './create-contest-helpers';

/** The fields of an event the helpers read; the rest of the DTO plays no part. */
function event(fields: Pick<SportEventDto, 'id' | 'sport'> & Partial<Pick<SportEventDto, 'scoringFamily'>>): SportEventDto {
  return { participantType: null, scoringFamily: null, ...fields } as SportEventDto;
}

type Preset = Pick<ContestConfigTemplateDto, 'id' | 'isDefault' | 'sportLeagueId'>;

function template(fields: Pick<ContestConfigTemplateDto, 'isDefault' | 'selectionType' | 'sortOrder' | 'sportLeagueId'>): ContestConfigTemplateDto {
  return fields as ContestConfigTemplateDto;
}

describe('definitionOfEvent', () => {
  it('uses the sport\'s own definition until an event is chosen', () => {
    expect(definitionOfEvent(Sport.GOLF, undefined, '')).toBe(getSportDefinition(Sport.GOLF));
    expect(definitionOfEvent(Sport.GOLF, [event({ id: 'other', sport: Sport.GOLF })], 'missing')).toBe(getSportDefinition(Sport.GOLF));
  });

  it('uses the chosen event\'s definition, so a stat pool event plays players by its composite, not its sport\'s bracket', () => {
    const definition = definitionOfEvent(
      Sport.BASKETBALL,
      [event({ id: 'finals', scoringFamily: ScoringFamily.COMPOSITE, sport: Sport.BASKETBALL })],
      'finals',
    );

    expect(definition.scoringDefinitions).toEqual(['COMPOSITE_TOTAL']);
    expect(definition.vocabulary.participant.many).toBe('players');
  });
});

describe('formatChoicesFor', () => {
  it('offers the sport\'s formats in its definition\'s order, each with its card\'s icon and description', () => {
    const choices = formatChoicesFor(getSportDefinition(Sport.GOLF));

    expect(choices.map((choice) => choice.selectionType)).toEqual([SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW]);
    expect(choices[0]?.describe({ one: 'golfer', many: 'golfers' })).toBe(
      'Pick golfers from each of the event\'s tiers, so the favorites are spread across every entry.',
    );
    expect(choices.every((choice) => typeof choice.icon === 'object' || typeof choice.icon === 'function')).toBe(true);
  });

  it('offers every format a sport with an entry screen for each one plays, squares and survivor included', () => {
    expect(formatChoicesFor(getSportDefinition(Sport.AMERICAN_FOOTBALL)).map((choice) => choice.selectionType)).toEqual([
      SelectionType.TIERED,
      SelectionType.BUDGET_PICK,
      SelectionType.RANDOM_DRAW,
      SelectionType.PICK_EM,
      SelectionType.BRACKET,
      SelectionType.SURVIVOR,
      SelectionType.SQUARES,
    ]);
  });
});

describe('isCreatableSelectionType', () => {
  it('accepts exactly the formats the page has a card for', () => {
    for (const selectionType of Object.values(SelectionType)) {
      expect(isCreatableSelectionType(selectionType)).toBe(creatableSelectionTypes.includes(selectionType as never));
    }
    expect(isCreatableSelectionType(SelectionType.TIERED)).toBe(true);
  });
});

describe('defaultPresetOf', () => {
  const sportWideDefault: Preset = { id: 'sport-wide', isDefault: true, sportLeagueId: null };
  const leagueDefault: Preset = { id: 'league', isDefault: true, sportLeagueId: 'nfl' };
  const plain: Preset = { id: 'plain', isDefault: false, sportLeagueId: null };

  it('starts on the event\'s sport league\'s own default over the sport-wide one', () => {
    expect(defaultPresetOf([plain, sportWideDefault, leagueDefault])?.id).toBe('league');
  });

  it('starts on the sport-wide default when the sport league has none', () => {
    expect(defaultPresetOf([plain, sportWideDefault])?.id).toBe('sport-wide');
  });

  it('starts on the first preset when none is a default, and on nothing when there are none', () => {
    expect(defaultPresetOf([plain])?.id).toBe('plain');
    expect(defaultPresetOf<Preset>([])).toBeUndefined();
  });
});

describe('leagueStartingFormatOf', () => {
  it('starts on the format of the sport league\'s first default by sort order', () => {
    const templates = [
      template({ isDefault: true, selectionType: SelectionType.TIERED, sortOrder: 2, sportLeagueId: 'f1' }),
      template({ isDefault: true, selectionType: SelectionType.BUDGET_PICK, sortOrder: 1, sportLeagueId: 'f1' }),
      template({ isDefault: true, selectionType: SelectionType.RANDOM_DRAW, sortOrder: 0, sportLeagueId: null }),
      template({ isDefault: false, selectionType: SelectionType.PICK_EM, sortOrder: 0, sportLeagueId: 'f1' }),
    ];

    expect(leagueStartingFormatOf(templates, () => true)).toBe(SelectionType.BUDGET_PICK);
  });

  it('skips a format the event cannot take, and keeps the chosen format when the league has no default left', () => {
    const templates = [
      template({ isDefault: true, selectionType: SelectionType.BUDGET_PICK, sortOrder: 1, sportLeagueId: 'f1' }),
      template({ isDefault: true, selectionType: SelectionType.TIERED, sortOrder: 2, sportLeagueId: 'f1' }),
    ];

    expect(leagueStartingFormatOf(templates, (format) => format !== SelectionType.BUDGET_PICK)).toBe(SelectionType.TIERED);
    expect(leagueStartingFormatOf(templates, () => false)).toBeNull();
    expect(leagueStartingFormatOf([], () => true)).toBeNull();
  });
});

describe('createContestFormSchema', () => {
  it('asks for an event and a name before a contest can be created', () => {
    const result = createContestFormSchema.safeParse({ contestName: ' ', sportEventId: '' });
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);

    expect(messages).toContain('Contest name is required.');
    expect(messages).toContain('Choose an event for the contest.');
  });
});
