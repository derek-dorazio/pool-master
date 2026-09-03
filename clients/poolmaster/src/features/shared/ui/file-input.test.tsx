import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileInput } from './file-input';

// plans/124 §6.4 — shared file-picker primitive (react-ui-rules §5 bars bare
// <input type="file"> in feature code).
describe('FileInput', () => {
  it('reads the selected file and hands back its text', async () => {
    const onFileText = vi.fn();
    render(<FileInput data-testid="csv" onFileText={onFileText} />);

    const file = new File(['externalId,playerName\ndj-1,Dustin Johnson'], 'roster.csv', {
      type: 'text/csv',
    });
    await userEvent.upload(screen.getByTestId('csv'), file);

    await waitFor(() =>
      expect(onFileText).toHaveBeenCalledWith(
        'externalId,playerName\ndj-1,Dustin Johnson',
        file,
      ),
    );
  });

  it('still forwards a raw onChange handler', async () => {
    const onChange = vi.fn();
    render(<FileInput data-testid="csv" onChange={onChange} />);

    await userEvent.upload(
      screen.getByTestId('csv'),
      new File(['x'], 'x.csv', { type: 'text/csv' }),
    );

    expect(onChange).toHaveBeenCalled();
  });
});
