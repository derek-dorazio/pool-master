import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/errors';
import { SettingsSaveError } from './settings-save-error';

const conflict = new ApiError({ error: { code: 'SETTINGS_CONFLICT', message: 'Changed by someone else; reload and try again.' } });

describe('SettingsSaveError', () => {
  it('shows nothing while the last save has not failed', () => {
    render(<SettingsSaveError conflicted={false} error={null} fallback="We could not save." onLoadLatest={vi.fn()} testId="save-error" />);

    expect(screen.queryByTestId('save-error')).not.toBeInTheDocument();
  });

  it('offers to load the newer settings when someone else saved first', async () => {
    const onLoadLatest = vi.fn(() => Promise.resolve());
    render(<SettingsSaveError conflicted error={conflict} fallback="We could not save." loadLabel="Load the latest plans" onLoadLatest={onLoadLatest} testId="save-error" />);

    expect(screen.getByTestId('save-error')).toHaveTextContent('Changed by someone else');
    await userEvent.click(screen.getByRole('button', { name: 'Load the latest plans' }));
    expect(onLoadLatest).toHaveBeenCalledTimes(1);
  });

  it('gives the fallback and no load button for any other failure', () => {
    render(<SettingsSaveError conflicted={false} error={new ApiError(undefined)} fallback="We could not save the email settings." onLoadLatest={vi.fn()} testId="save-error" />);

    expect(screen.getByTestId('save-error')).toHaveTextContent('We could not save the email settings.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
