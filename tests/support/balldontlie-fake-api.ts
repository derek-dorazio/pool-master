import { describeErrors, loadVendorSpec, type VendorQueryParameter } from './balldontlie-vendor-spec';
import Ajv2020 from 'ajv/dist/2020';

/**
 * A stand-in for `fetch` that answers like BALLDONTLIE and checks every request and response
 * against the vendor's own OpenAPI document:
 *
 * - the API key arrives as the bare `Authorization` header;
 * - the path is one the document declares for GET;
 * - every query parameter is declared there, each value fits its declared schema, and every
 *   required one is present;
 * - every 200 body a test serves fits the document's response schema.
 *
 * Anything else throws `BalldontlieSpecViolation` and is kept in `violations`. The adapter's
 * client treats a throwing fetch as a network failure and retries, so a test checks
 * `violations` is empty after every call (the adapter suite does it in `afterEach`). So an
 * adapter test passes only if what the adapter sends, and what it was given to read, are what
 * the vendor documents.
 */

export class BalldontlieSpecViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BalldontlieSpecViolation';
  }
}

export interface FakeRequest {
  path: string;
  query: URLSearchParams;
  authorization: string | null;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  /** Sent as-is instead of `body`, for a reply that is not JSON. */
  rawBody?: string;
  headers?: Record<string, string>;
}

export type FakeRoute = (request: FakeRequest) => FakeReply | Promise<FakeReply>;

export interface FakeBalldontlie {
  fetch: typeof fetch;
  /** Every request, in order, as the adapter sent it. */
  readonly requests: FakeRequest[];
  /** Every request or reply that broke the vendor document, as its message. */
  readonly violations: string[];
}

const parameterAjv = new Ajv2020({ strict: false });

function coerce(value: string, schema: Record<string, unknown>): unknown {
  if (schema['type'] === 'integer' || schema['type'] === 'number') return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  if (schema['type'] === 'boolean') return value === 'true' ? true : value === 'false' ? false : value;
  return value;
}

function checkQuery(path: string, query: URLSearchParams, declared: readonly VendorQueryParameter[]): void {
  const byName = new Map(declared.map((parameter) => [parameter.name, parameter]));
  for (const name of new Set(query.keys())) {
    const parameter = byName.get(name);
    if (!parameter) {
      throw new BalldontlieSpecViolation(`GET ${path} sent query parameter "${name}", which the vendor document does not declare (declared: ${declared.map((p) => p.name).join(', ')})`);
    }
    const values = query.getAll(name);
    const schema = parameter.schema;
    const isArray = schema['type'] === 'array';
    if (!isArray && values.length > 1) {
      throw new BalldontlieSpecViolation(`GET ${path} sent "${name}" ${String(values.length)} times; the document declares one value`);
    }
    const itemSchema = (isArray ? schema['items'] : schema) as Record<string, unknown>;
    const validate = parameterAjv.compile(itemSchema);
    for (const value of values) {
      if (!validate(coerce(value, itemSchema))) {
        throw new BalldontlieSpecViolation(`GET ${path} sent ${name}=${value}, which does not fit ${JSON.stringify(itemSchema)}`);
      }
    }
  }
  for (const parameter of declared) {
    if (parameter.required && !query.has(parameter.name)) {
      throw new BalldontlieSpecViolation(`GET ${path} left out required query parameter "${parameter.name}"`);
    }
  }
}

/**
 * @param routes the replies, by path. A path the document declares but no route serves
 *   answers 404, as an unknown resource would.
 */
export function createFakeBalldontlie(options: {
  league: string;
  apiKey: string;
  routes: Readonly<Partial<Record<string, FakeRoute>>>;
}): FakeBalldontlie {
  const spec = loadVendorSpec(options.league);
  const requests: FakeRequest[] = [];
  const violations: string[] = [];

  const answer = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const request: FakeRequest = { path: url.pathname, query: url.searchParams, authorization: headers.get('authorization') };
    requests.push(request);

    if ((init?.method ?? 'GET') !== 'GET') {
      throw new BalldontlieSpecViolation(`${init?.method ?? ''} ${url.pathname}: the adapter only reads`);
    }
    if (!spec.paths.includes(url.pathname)) {
      throw new BalldontlieSpecViolation(`GET ${url.pathname} is not a path the vendor document declares`);
    }
    checkQuery(url.pathname, url.searchParams, spec.queryParameters(url.pathname));
    if (request.authorization !== options.apiKey) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const route = options.routes[url.pathname];
    if (!route) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    const reply = await route(request);
    const status = reply.status ?? 200;
    if (reply.rawBody !== undefined) {
      return new Response(reply.rawBody, { status, headers: reply.headers });
    }
    if (status === 200) {
      const validate = spec.responseValidator(url.pathname);
      if (!validate(reply.body)) {
        throw new BalldontlieSpecViolation(`The reply served for GET ${url.pathname} does not fit the vendor document:\n${describeErrors(validate)}`);
      }
    }
    return Response.json(reply.body ?? null, { status, headers: reply.headers });
  };

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    try {
      return await answer(input, init);
    } catch (error) {
      if (error instanceof BalldontlieSpecViolation) violations.push(error.message);
      throw error;
    }
  };

  return { fetch: fakeFetch, requests, violations };
}

/**
 * A route that serves `rows` the way the vendor's cursor pagination does: `per_page` rows
 * after `cursor`, ordered by id, with `next_cursor` the last id served while more remain.
 * `filter` keeps the rows a request's other parameters select.
 */
export function pagedRoute<Row extends { id: number }>(
  rows: readonly Row[],
  filter: (row: Row, query: URLSearchParams) => boolean = () => true,
): FakeRoute {
  return ({ query }) => {
    const perPage = Number(query.get('per_page') ?? '25');
    const cursor = query.has('cursor') ? Number(query.get('cursor')) : null;
    const selected = [...rows]
      .filter((row) => filter(row, query))
      .sort((a, b) => a.id - b.id)
      .filter((row) => cursor === null || row.id > cursor);
    const page = selected.slice(0, perPage);
    const more = selected.length > perPage;
    return {
      body: {
        data: page,
        meta: { per_page: perPage, ...(more ? { next_cursor: page[page.length - 1].id } : {}) },
      },
    };
  };
}
