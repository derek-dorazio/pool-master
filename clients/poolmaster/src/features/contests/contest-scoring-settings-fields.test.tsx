import { getSportDefinition, Sport } from '@poolmaster/shared/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_SCORING_SETTINGS_VALUES, SCORING_SETTINGS_UI, type ScoringSettingsValues } from './contest-scoring-settings';
import { FinishPositionPointsFields, KnockoutRoundPointsFields } from './contest-scoring-settings-fields';

// The points table's hint reads the sport's own name for its top places, so a second
// finish-position sport never inherits horse racing's "Win / Place / Show".

const values = { ...EMPTY_SCORING_SETTINGS_VALUES, pointsTable: '5, 3, 1', didNotFinishPoints: '0' };

describe('FinishPositionPointsFields', () => {
  it('names the top places in horse racing\'s words and the participant as a horse', () => {
    render(
      <FinishPositionPointsFields
        onChange={vi.fn()}
        values={values}
        vocabulary={getSportDefinition(Sport.HORSE_RACING).vocabulary}
      />,
    );

    expect(screen.getByText('Points by finishing place, winner first: 5, 3, 1 is Win / Place / Show. A place beyond the table scores 0.')).toBeInTheDocument();
    expect(screen.getByText('What a horse scores when it does not finish, is disqualified or does not start.')).toBeInTheDocument();
  });

  it('leaves out the top-places example for a sport whose vocabulary has no name for them', () => {
    const vocabulary = {
      ...getSportDefinition(Sport.HORSE_RACING).vocabulary,
      participant: { one: 'driver', many: 'drivers' },
      topPlaces: undefined,
    };
    render(
      <FinishPositionPointsFields
        onChange={vi.fn()}
        values={values}
        vocabulary={vocabulary}
      />,
    );

    expect(screen.getByText('Points by finishing place, winner first. A place beyond the table scores 0.')).toBeInTheDocument();
    expect(screen.queryByText(/Win \/ Place \/ Show/)).not.toBeInTheDocument();
    expect(screen.getByText('What a driver scores when it does not finish, is disqualified or does not start.')).toBeInTheDocument();
  });
});

describe('KnockoutRoundPointsFields', () => {
  const vocabulary = getSportDefinition(Sport.BASKETBALL).vocabulary;

  it('asks for a win\'s points in each round and shows the multiplier only with the upset bonus on', () => {
    const { rerender } = render(
      <KnockoutRoundPointsFields onChange={vi.fn()} values={{ ...EMPTY_SCORING_SETTINGS_VALUES, roundValues: '1, 2' }} vocabulary={vocabulary} />,
    );

    expect(screen.getByTestId('contest-scoring-round-values')).toHaveValue('1, 2');
    expect(screen.queryByTestId('contest-scoring-upset-bonus-multiplier')).not.toBeInTheDocument();

    rerender(
      <KnockoutRoundPointsFields onChange={vi.fn()} values={{ ...EMPTY_SCORING_SETTINGS_VALUES, upsetBonusRule: 'SEED_DIFFERENCE' }} vocabulary={vocabulary} />,
    );
    expect(screen.getByTestId('contest-scoring-upset-bonus-multiplier')).toHaveValue(1);
  });

  /** The fields in a form that keeps their values, as the create page does, showing what it would save. */
  function KnockoutForm({ initial }: { initial: ScoringSettingsValues }) {
    const [current, setCurrent] = useState(initial);
    return (
      <>
        <KnockoutRoundPointsFields onChange={(patch) => setCurrent((previous) => ({ ...previous, ...patch }))} values={current} vocabulary={vocabulary} />
        <output data-testid="saved-scoring">{JSON.stringify(SCORING_SETTINGS_UI.KNOCKOUT_ROUND_POINTS.parse(current).scoring ?? null)}</output>
      </>
    );
  }
  const saved = () => JSON.parse(screen.getByTestId('saved-scoring').textContent) as unknown;

  it('saves the round values typed, and the upset bonus with the multiplier typed once the bonus is switched on', () => {
    render(<KnockoutForm initial={{ ...EMPTY_SCORING_SETTINGS_VALUES, roundValues: '1, 2' }} />);

    fireEvent.change(screen.getByTestId('contest-scoring-round-values'), { target: { value: '1, 2, 4' } });
    expect(saved()).toEqual({ participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1, 2, 4], upsetBonus: { rule: 'NONE' } } });

    fireEvent.change(screen.getByTestId('contest-scoring-upset-bonus'), { target: { value: 'SEED_DIFFERENCE' } });
    fireEvent.change(screen.getByTestId('contest-scoring-upset-bonus-multiplier'), { target: { value: '3' } });
    expect(saved()).toEqual({ participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1, 2, 4], upsetBonus: { rule: 'SEED_DIFFERENCE', multiplier: 3 } } });
  });

  it('hides the multiplier and saves no bonus once the upset bonus is switched back off', () => {
    render(<KnockoutForm initial={{ ...EMPTY_SCORING_SETTINGS_VALUES, roundValues: '1, 2', upsetBonusRule: 'SEED_DIFFERENCE', upsetBonusMultiplier: '2' }} />);

    fireEvent.change(screen.getByTestId('contest-scoring-upset-bonus'), { target: { value: 'NONE' } });

    expect(screen.queryByTestId('contest-scoring-upset-bonus-multiplier')).not.toBeInTheDocument();
    expect(saved()).toEqual({ participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1, 2], upsetBonus: { rule: 'NONE' } } });
  });
});
