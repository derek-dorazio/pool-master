import { useCallback, useMemo, useState, type ReactNode } from "react";
import { cn } from "./class-names";
import { Alert } from "./alert";
import { Button } from "./button";
import { FileInput } from "./file-input";
import { FormField, Textarea } from "./form-field";
import { SegmentedControl } from "./tabs";
import type { BulkUploadFormat } from "./bulk-upload-parse";

export type { BulkUploadFormat } from "./bulk-upload-parse";

export type BulkUploadPanelProps<TRow, TPreviewRow> = {
  testId: string;
  /** Column headers, used for the downloadable CSV template and the format hint. */
  templateHeaders: readonly string[];
  /** File name for the downloaded template, e.g. `golf-league-roster-template.csv`. */
  templateFilename: string;
  /** Optional example data row rendered under the header line in the template. */
  templateSampleRow?: readonly (string | number)[];
  /** Extra guidance rendered beneath the paste box (column meanings, etc.). */
  formatNote?: ReactNode;
  /**
   * Pure parse of the pasted / uploaded text into request rows. Must throw an
   * `Error` with a user-facing `message` when the text is malformed.
   */
  parse: (text: string, format: BulkUploadFormat) => TRow[];
  preview: (rows: TRow[]) => Promise<TPreviewRow[]>;
  isPreviewPending: boolean;
  previewError: ReactNode;
  renderPreview: (rows: readonly TPreviewRow[]) => ReactNode;
  /** How many preview rows still need attention. Apply is blocked while > 0. */
  unresolvedCount: (rows: readonly TPreviewRow[]) => number;
  /**
   * Message shown when `unresolvedCount > 0`. Defaults to a generic phrasing;
   * each consumer overrides it with its own noun (roster: "player", scores:
   * "field entry").
   */
  unresolvedNotice?: (count: number) => ReactNode;
  apply: (rows: TRow[]) => Promise<void>;
  isApplyPending: boolean;
  applyError: ReactNode;
  applyLabel?: string;
  onApplied?: () => void;
};

function buildTemplateCsv(
  headers: readonly string[],
  sampleRow: readonly (string | number)[] | undefined,
): string {
  const lines = [headers.join(",")];
  if (sampleRow && sampleRow.length > 0) {
    lines.push(sampleRow.map((cell) => String(cell)).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * plans/124 §6.3 / §6.4 — the paste / upload / preview / apply flow shared by the
 * golf league-roster editor (pool-master-qqs) and the round-scores editor
 * (pool-master-r11). The panel owns the format toggle, paste box, file upload,
 * template download, and Apply gating; the caller owns the row schema, the
 * parser, and the preview / apply mutations (so cache invalidation stays with
 * the feature, per `rules/react-ui-rules.md` §4).
 */
export function BulkUploadPanel<TRow, TPreviewRow>({
  testId,
  templateHeaders,
  templateFilename,
  templateSampleRow,
  formatNote,
  parse,
  preview,
  isPreviewPending,
  previewError,
  renderPreview,
  unresolvedCount,
  unresolvedNotice = (count) =>
    `${count} row${count === 1 ? "" : "s"} could not be resolved. Fix or remove ${
      count === 1 ? "it" : "them"
    } before applying.`,
  apply,
  isApplyPending,
  applyError,
  applyLabel = "Apply",
  onApplied,
}: BulkUploadPanelProps<TRow, TPreviewRow>) {
  const [format, setFormat] = useState<BulkUploadFormat>("CSV");
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<readonly TPreviewRow[] | null>(
    null,
  );

  const resetPreview = useCallback(() => {
    setPreviewRows(null);
    setParseError(null);
  }, []);

  const parseCurrent = useCallback((): TRow[] | null => {
    try {
      const rows = parse(text, format);
      setParseError(null);
      return rows;
    } catch (error) {
      setParseError(
        error instanceof Error && error.message
          ? error.message
          : "That input could not be parsed.",
      );
      return null;
    }
  }, [format, parse, text]);

  const handlePreview = useCallback(() => {
    const rows = parseCurrent();
    if (!rows) {
      return;
    }
    void preview(rows).then(
      (result) => setPreviewRows(result),
      () => setPreviewRows(null),
    );
  }, [parseCurrent, preview]);

  const handleApply = useCallback(() => {
    const rows = parseCurrent();
    if (!rows) {
      return;
    }
    void apply(rows).then(() => {
      resetPreview();
      setText("");
      onApplied?.();
    });
  }, [apply, onApplied, parseCurrent, resetPreview]);

  const templateHref = useMemo(
    () =>
      `data:text/csv;charset=utf-8,${encodeURIComponent(
        buildTemplateCsv(templateHeaders, templateSampleRow),
      )}`,
    [templateHeaders, templateSampleRow],
  );

  const unresolved = previewRows ? unresolvedCount(previewRows) : 0;
  const canApply =
    previewRows !== null &&
    previewRows.length > 0 &&
    unresolved === 0 &&
    !isApplyPending;

  return (
    <div className={cn("space-y-4")} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="Upload format"
          onChange={(value) => {
            setFormat(value as BulkUploadFormat);
            resetPreview();
          }}
          options={[
            { label: "CSV", value: "CSV" },
            { label: "JSON", value: "JSON" },
          ]}
          value={format}
        />
        <a
          className="text-sm font-medium text-primary underline underline-offset-4"
          data-testid={`${testId}-template`}
          download={templateFilename}
          href={templateHref}
        >
          Download CSV template
        </a>
      </div>

      <FormField
        helperText={
          formatNote ?? `Columns: ${templateHeaders.join(", ")}`
        }
        label={format === "CSV" ? "Paste CSV rows" : "Paste JSON array"}
      >
        <Textarea
          data-testid={`${testId}-textarea`}
          onChange={(event) => {
            setText(event.target.value);
            resetPreview();
          }}
          rows={6}
          value={text}
        />
      </FormField>

      <FormField helperText="Uploading a file replaces the text above." label="…or upload a file">
        <FileInput
          accept={format === "CSV" ? ".csv,text/csv" : ".json,application/json"}
          data-testid={`${testId}-file`}
          onFileText={(fileText) => {
            setText(fileText);
            resetPreview();
          }}
        />
      </FormField>

      {parseError ? (
        <Alert tone="danger" data-testid={`${testId}-parse-error`}>
          {parseError}
        </Alert>
      ) : null}

      {previewError ? (
        <Alert tone="danger" data-testid={`${testId}-preview-error`}>
          {previewError}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          data-testid={`${testId}-preview`}
          disabled={text.trim() === "" || isPreviewPending}
          isLoading={isPreviewPending}
          onClick={handlePreview}
          variant="secondary"
        >
          Preview
        </Button>
        <Button
          data-testid={`${testId}-apply`}
          disabled={!canApply}
          isLoading={isApplyPending}
          onClick={handleApply}
        >
          {applyLabel}
        </Button>
      </div>

      {previewRows ? (
        <div className="space-y-3" data-testid={`${testId}-preview-result`}>
          {unresolved > 0 ? (
            <Alert tone="warning" data-testid={`${testId}-unresolved`}>
              {unresolvedNotice(unresolved)}
            </Alert>
          ) : null}
          {renderPreview(previewRows)}
        </div>
      ) : null}

      {applyError ? (
        <Alert tone="danger" data-testid={`${testId}-apply-error`}>
          {applyError}
        </Alert>
      ) : null}
    </div>
  );
}
