import { getSportDefinition, Sport } from '@poolmaster/shared/domain';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FinishPositionPointsFields } from './contest-scoring-settings-fields';

// The points table's hint reads the sport's own name for its top places, so a second
// finish-position sport never inherits horse racing's "Win / Place / Show".

const values = { pointsTable: '5, 3, 1', didNotFinishPoints: '0' };

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
