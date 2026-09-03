export type BulkUploadFormat = "CSV" | "JSON";

/**
 * plans/124 §6.4 — the format-level tokeniser shared by every {@link BulkUploadPanel}
 * consumer. It turns pasted CSV / JSON text into a list of
 * `{ column: value }` records; the feature layer (golf-admin-utils.ts) then
 * validates and coerces those records against a row schema.
 *
 * CSV: the first non-empty line is the header row; each later non-empty line is
 * split on commas and zipped against the headers. JSON: the text must be an
 * array of plain objects. Both throw an `Error` with a user-facing message on
 * malformed input so the panel can surface it inline.
 */
export function parseDelimitedRecords(
  text: string,
  format: BulkUploadFormat,
): Array<Record<string, unknown>> {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new Error("Paste or upload some rows first.");
  }

  if (format === "JSON") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("That is not valid JSON.");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("JSON input must be an array of row objects.");
    }
    return parsed.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`Row ${index + 1} is not a JSON object.`);
      }
      return entry as Record<string, unknown>;
    });
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (lines.length < 2) {
    throw new Error("Add a header row and at least one data row.");
  }

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      const cell = cells[index]?.trim() ?? "";
      if (cell !== "") {
        record[header] = cell;
      }
    });
    return record;
  });
}

function splitCsvLine(line: string): string[] {
  return line.split(",").map((cell) => cell.trim());
}
