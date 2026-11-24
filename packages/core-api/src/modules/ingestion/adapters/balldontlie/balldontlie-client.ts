/**
 * The one HTTP client every BALLDONTLIE read goes through: the API key, cursor pagination, the
 * run's payload capture, and parsing each response against the schema of the fields PoolMaster
 * reads. Each request is one attempt run under the provider's call policy, which paces it to this
 * task's share of the plan's rate limit and is the only layer that retries (league model 1c).
 *
 * The API key is sent as the bare `Authorization` header value, as the vendor's OpenAPI
 * `ApiKeyAuth` scheme says (no "Bearer" prefix).
 */

import { z } from 'zod';
import { errorMessage } from '../../../../core/error-message';
import type { ProviderPayloadRecorder } from '../provider-payload-recorder';
import { JobErrorType } from '@poolmaster/shared/domain';
import { jobErrorTypeOf, jobErrorTypeOfStatus } from '../../../background-jobs/job-error-type';
import { ProviderCallPolicy, ProviderFailureKind, type ProviderCallFailure } from '../../core/provider-call-policy';

/** A query value: arrays are sent once per item, under the key exactly as given (`tournament_ids[]`). */
export type BalldontlieQueryValue = string | number | boolean | readonly (string | number)[];
export type BalldontlieQuery = Readonly<Record<string, BalldontlieQueryValue | undefined>>;

/** `Pagination`, on every league's list responses: `next_cursor` is absent (or null) on the last page. */
export const balldontliePaginationSchema = z.object({
  next_cursor: z.number().int().nullable().optional(),
});

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
  /** The most tasks that run background work at once; this task takes an even share of the limit. 1 when unset. */
  maxTasks?: number;
  payloads: ProviderPayloadRecorder;
  /** How long one attempt may take before it is abandoned (and, by the call policy, retried). */
  timeoutMs?: number;
  /** Clock and wait, injectable so the pacing is testable without real time. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
/** The vendor's largest page; fewer pages keep a sweep inside the plan's rate limit. */
export const BALLDONTLIE_MAX_PER_PAGE = 100;
/** A cursor loop that has not ended after this many pages is treated as a vendor fault. */
const MAX_PAGES = 200;

/** The response did not match the documented shape PoolMaster relies on. */
export class BalldontlieContractError extends Error {
  /** Activity's Error column (#1861). */
  readonly jobErrorType = JobErrorType.BAD_DATA;

  constructor(
    readonly path: string,
    readonly issues: readonly string[],
  ) {
    super(`BALLDONTLIE response for ${path} did not match the documented contract: ${issues.join('; ')}`);
    this.name = 'BalldontlieContractError';
  }
}

/** One request the API answered with an error status, or never answered. */
export class BalldontlieRequestError extends Error implements ProviderCallFailure {
  constructor(
    readonly path: string,
    readonly status: number | null,
    message: string,
    options?: { cause?: unknown; retryAfterMs?: number | null },
  ) {
    super(`BALLDONTLIE request ${path} failed: ${message}`, options);
    this.name = 'BalldontlieRequestError';
    this.retryAfterMs = options?.retryAfterMs ?? null;
  }

  /** The wait a 429's Retry-After named. */
  readonly retryAfterMs: number | null;

  /** A 429 is rate limited; a 5xx or no answer is worth trying again; anything else is final. */
  get providerFailure(): ProviderFailureKind {
    if (this.status === 429) return ProviderFailureKind.RATE_LIMITED;
    if (this.status === null || RETRYABLE_STATUSES.has(this.status)) return ProviderFailureKind.TRANSIENT;
    return ProviderFailureKind.FINAL;
  }

  /**
   * Activity's Error column (#1861): a 429 is RATE_LIMITED and any other status PROVIDER_ERROR; no
   * answer at all is TIMEOUT when the last try timed out, else PROVIDER_ERROR.
   */
  get jobErrorType(): JobErrorType {
    if (this.status !== null) return jobErrorTypeOfStatus(this.status);
    return jobErrorTypeOf(this.cause) === JobErrorType.TIMEOUT ? JobErrorType.TIMEOUT : JobErrorType.PROVIDER_ERROR;
  }
}

/** Statuses a later try may answer differently: the server's own failures. A 429 is rate limited. */
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

export class BalldontlieClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly policy: ProviderCallPolicy;

  constructor(private readonly options: BalldontlieClientOptions) {
    this.policy = new ProviderCallPolicy({
      providerId: 'BALLDONTLIE',
      requestsPerMinute: options.requestsPerMinute,
      maxTasks: options.maxTasks ?? 1,
      ...(options.now && { now: options.now }),
      ...(options.sleep && { sleep: options.sleep }),
    });
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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

  private request(pathAndQuery: string): Promise<unknown> {
    return this.policy.execute(() => this.attempt(pathAndQuery));
  }

  /** One try: the parsed body, or the error that says what kind of failure it was. */
  private async attempt(pathAndQuery: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${pathAndQuery}`, {
        headers: { Authorization: this.options.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new BalldontlieRequestError(pathAndQuery, null, `no response: ${errorMessage(error)}`, { cause: error });
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

    throw new BalldontlieRequestError(
      pathAndQuery,
      response.status,
      `${String(response.status)} ${await readErrorMessage(response)}`,
      { retryAfterMs: retryAfterMs(response) },
    );
  }
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
