/**
 * The one HTTP client every BALLDONTLIE read goes through: the API key, the plan's rate limit,
 * retries on 429, 5xx and timeouts, cursor pagination, the run's payload capture, and parsing
 * each response against the schema of the fields PoolMaster reads.
 *
 * The API key is sent as the bare `Authorization` header value, as the vendor's OpenAPI
 * `ApiKeyAuth` scheme says (no "Bearer" prefix).
 */

import type { z } from 'zod';
import { errorMessage } from '../../../../core/error-message';
import type { ProviderPayloadRecorder } from '../provider-payload-recorder';

/** A query value: arrays are sent once per item, under the key exactly as given (`tournament_ids[]`). */
export type BalldontlieQueryValue = string | number | boolean | readonly (string | number)[];
export type BalldontlieQuery = Readonly<Record<string, BalldontlieQueryValue | undefined>>;

/** A list response: its rows and the documented `Pagination` meta. */
export interface BalldontliePage<Row> {
  data: Row[];
  meta?: { next_cursor?: number | null };
}

export interface BalldontlieClientOptions {
  baseUrl: string;
  apiKey: string;
  /** The plan's limit: 5 on the free plan, 60 on ALL-STAR, 600 on GOAT and All-Access. */
  requestsPerMinute: number;
  payloads: ProviderPayloadRecorder;
  /** How long one attempt may take before it is abandoned and retried. */
  timeoutMs?: number;
  /** Attempts after the first, for a 429, a 5xx or a timeout. */
  maxRetries?: number;
  /** Clock and wait, injectable so the limiter and back-off are testable without real time. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
/** Back-off before retry n (from 1) when the response names no Retry-After: 1 s, 2 s, 4 s... */
const BACKOFF_BASE_MS = 1_000;
/** The vendor's largest page; fewer pages keep a sweep inside the plan's rate limit. */
export const BALLDONTLIE_MAX_PER_PAGE = 100;
/** A cursor loop that has not ended after this many pages is treated as a vendor fault. */
const MAX_PAGES = 200;

/** The response did not match the documented shape PoolMaster relies on. */
export class BalldontlieContractError extends Error {
  constructor(
    readonly path: string,
    readonly issues: readonly string[],
  ) {
    super(`BALLDONTLIE response for ${path} did not match the documented contract: ${issues.join('; ')}`);
    this.name = 'BalldontlieContractError';
  }
}

/** The API answered with an error status, or never answered, after every retry. */
export class BalldontlieRequestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`BALLDONTLIE request ${path} failed: ${message}`, options);
    this.name = 'BalldontlieRequestError';
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class BalldontlieClient {
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** When the next request may start; requests reserve their slot in call order. */
  private nextSlotAt = 0;

  constructor(private readonly options: BalldontlieClientOptions) {
    if (!Number.isInteger(options.requestsPerMinute) || options.requestsPerMinute < 1) {
      throw new Error(`BALLDONTLIE requestsPerMinute must be a whole number of at least 1, not ${String(options.requestsPerMinute)}.`);
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.minIntervalMs = Math.ceil(60_000 / options.requestsPerMinute);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));
  }

  /** One GET, parsed against `schema`. */
  async get<S extends z.ZodType>(path: string, query: BalldontlieQuery, schema: S): Promise<z.infer<S>> {
    const url = this.buildUrl(path, query);
    const body = await this.request(url);
    return parseAgainst(schema, url, body);
  }

  /**
   * Every page of a cursor-paginated list, each page parsed against `schema` and its rows
   * concatenated. Pages are fetched one after another, as the cursor requires.
   */
  async getAllPages<Row>(
    path: string,
    query: BalldontlieQuery,
    schema: z.ZodType<BalldontliePage<Row>>,
  ): Promise<Row[]> {
    const rows: Row[] = [];
    let cursor: number | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = this.buildUrl(path, { ...query, per_page: BALLDONTLIE_MAX_PER_PAGE, cursor });
      const body = await this.request(url);
      const parsed = parseAgainst(schema, url, body);
      rows.push(...parsed.data);
      const nextCursor = parsed.meta?.next_cursor;
      // The vendor's documented page shows next_cursor set even on the final page, so a short
      // page ends the loop as surely as a missing cursor does.
      if (nextCursor === undefined || nextCursor === null || parsed.data.length < BALLDONTLIE_MAX_PER_PAGE) {
        return rows;
      }
      cursor = nextCursor;
    }
    throw new BalldontlieContractError(path, [`pagination did not end after ${String(MAX_PAGES)} pages`]);
  }

  private buildUrl(path: string, query: BalldontlieQuery): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value as readonly (string | number)[]) params.append(key, String(item));
        continue;
      }
      params.append(key, String(value));
    }
    const search = params.toString();
    return search ? `${path}?${search}` : path;
  }

  /** Waits for the next free slot under the rate limit, then holds it. */
  private async takeSlot(): Promise<void> {
    const now = this.now();
    const startAt = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = startAt + this.minIntervalMs;
    if (startAt > now) {
      await this.sleep(startAt - now);
    }
  }

  private async request(pathAndQuery: string): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      await this.takeSlot();
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}${pathAndQuery}`, {
          headers: { Authorization: this.options.apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt + 1));
          continue;
        }
        throw new BalldontlieRequestError(pathAndQuery, null, `no response after ${String(attempt + 1)} attempts`, { cause: error });
      }

      if (response.ok) {
        const text = await response.text();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch (error) {
          throw new BalldontlieContractError(pathAndQuery, [`response is not JSON: ${errorMessage(error)}`]);
        }
        this.options.payloads.record(pathAndQuery, text.length, body);
        return body;
      }

      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
        await this.sleep(retryAfterMs(response) ?? backoffMs(attempt + 1));
        continue;
      }
      throw new BalldontlieRequestError(
        pathAndQuery,
        response.status,
        `${String(response.status)} ${await readErrorMessage(response)}`,
      );
    }
  }
}

function backoffMs(retry: number): number {
  return BACKOFF_BASE_MS * 2 ** (retry - 1);
}

/** Retry-After in whole seconds, as a 429 may carry it; an HTTP-date or junk is ignored. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim()) * 1_000;
}

/** The vendor's `Error` body (`{ "error": "..." }`) when there is one, else the status text. */
async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    // Not JSON: the status text below is all there is.
  }
  return response.statusText;
}

function parseAgainst<S extends z.ZodType>(schema: S, path: string, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BalldontlieContractError(
      path,
      result.error.issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
