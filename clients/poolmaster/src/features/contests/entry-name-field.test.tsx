import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EntryNameField } from './entry-name-field';

describe('EntryNameField', () => {
  it('labels the field Entry name, caps it at 100 characters and passes each change up', () => {
    const onChange = vi.fn();
    render(<EntryNameField onChange={onChange} testId="name" value="Tiger 1" />);

    const input = screen.getByLabelText('Entry name');
    expect(input).toHaveValue('Tiger 1');
    expect(input).toHaveAttribute('maxLength', '100');
    fireEvent.change(input, { target: { value: 'Tiger 2' } });
    expect(onChange).toHaveBeenCalledWith('Tiger 2');
  });

  it('has no Save or Cancel of its own when the page saves the name', () => {
    render(<EntryNameField onChange={vi.fn()} testId="name" value="Tiger 1" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('saves the trimmed name, and cancels, with its own buttons when given save', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <EntryNameField
        onChange={vi.fn()}
        save={{ cancelTestId: 'cancel', isSaving: false, onCancel, onSave, saveTestId: 'save' }}
        testId="name"
        value="  Tiger 2  "
      />,
    );

    fireEvent.click(screen.getByTestId('save'));
    fireEvent.click(screen.getByTestId('cancel'));

    expect(onSave).toHaveBeenCalledWith('Tiger 2');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps Save closed for a blank name', () => {
    render(
      <EntryNameField
        onChange={vi.fn()}
        save={{ cancelTestId: 'cancel', isSaving: false, onCancel: vi.fn(), onSave: vi.fn(), saveTestId: 'save' }}
        testId="name"
        value="   "
      />,
    );

    expect(screen.getByTestId('save')).toBeDisabled();
  });

  it('locks the field and both buttons while a save runs, and shows why the last save was refused', () => {
    render(
      <EntryNameField
        error="That name is taken."
        onChange={vi.fn()}
        save={{ cancelTestId: 'cancel', isSaving: true, onCancel: vi.fn(), onSave: vi.fn(), saveTestId: 'save' }}
        testId="name"
        value="Tiger 2"
      />,
    );

    expect(screen.getByTestId('name')).toBeDisabled();
    expect(screen.getByTestId('save')).toBeDisabled();
    expect(screen.getByTestId('cancel')).toBeDisabled();
    expect(screen.getByText('That name is taken.')).toBeInTheDocument();
  });
});
