import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BulkUploadPanel } from './bulk-upload-panel';

// plans/124 §6.3 / §6.4 — the shared paste/upload/preview/apply flow.
// rule: Apply stays disabled until every previewed row resolves (react-ui-rules §8
// "avoid interaction dead-ends").

type Row = { name: string };
type PreviewRow = { name: string; resolved: boolean };

function setup(overrides: Partial<Parameters<typeof BulkUploadPanel<Row, PreviewRow>>[0]> = {}) {
  const preview = vi.fn(async (rows: Row[]): Promise<PreviewRow[]> =>
    rows.map((row) => ({ name: row.name, resolved: row.name !== 'ghost' })),
  );
  const apply = vi.fn(async () => undefined);

  render(
    <BulkUploadPanel<Row, PreviewRow>
      apply={apply}
      applyError={null}
      isApplyPending={false}
      isPreviewPending={false}
      parse={(text) => {
        if (text.includes('!')) {
          throw new Error('Bad row.');
        }
        return text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((name) => ({ name }));
      }}
      preview={preview}
      previewError={null}
      renderPreview={(rows) => (
        <ul data-testid="preview-list">
          {rows.map((row) => (
            <li key={row.name}>{row.name}</li>
          ))}
        </ul>
      )}
      templateFilename="thing-template.csv"
      templateHeaders={['name']}
      testId="panel"
      unresolvedCount={(rows) => rows.filter((row) => !row.resolved).length}
      {...overrides}
    />,
  );

  return { preview, apply };
}

describe('BulkUploadPanel', () => {
  it('surfaces a parse error inline and does not call preview', async () => {
    const { preview } = setup();

    await userEvent.type(screen.getByTestId('panel-textarea'), 'oops!');
    await userEvent.click(screen.getByTestId('panel-preview'));

    expect(await screen.findByTestId('panel-parse-error')).toHaveTextContent('Bad row.');
    expect(preview).not.toHaveBeenCalled();
  });

  it('clears an existing preview when the CSV/JSON format is switched', async () => {
    setup();

    await userEvent.type(screen.getByTestId('panel-textarea'), 'rory');
    await userEvent.click(screen.getByTestId('panel-preview'));
    await screen.findByTestId('preview-list');

    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));

    expect(screen.queryByTestId('preview-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('panel-apply')).toBeDisabled();
  });

  it('keeps Apply disabled while a previewed row is unresolved, then enables it', async () => {
    const { apply } = setup();

    await userEvent.type(screen.getByTestId('panel-textarea'), 'rory\nghost');
    await userEvent.click(screen.getByTestId('panel-preview'));

    await screen.findByTestId('preview-list');
    expect(screen.getByTestId('panel-unresolved')).toHaveTextContent('1 row');
    expect(screen.getByTestId('panel-apply')).toBeDisabled();

    // Re-preview with only resolvable rows.
    await userEvent.clear(screen.getByTestId('panel-textarea'));
    await userEvent.type(screen.getByTestId('panel-textarea'), 'rory');
    await userEvent.click(screen.getByTestId('panel-preview'));

    await waitFor(() => expect(screen.getByTestId('panel-apply')).toBeEnabled());
    await userEvent.click(screen.getByTestId('panel-apply'));

    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith([{ name: 'rory' }]),
    );
    // Applying clears the textarea and preview.
    await waitFor(() =>
      expect(screen.getByTestId('panel-textarea')).toHaveValue(''),
    );
  });
});
