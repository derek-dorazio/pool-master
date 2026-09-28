import { http, HttpResponse, type HttpHandler } from 'msw';
import { setupServer } from 'msw/node';
import { beforeEach, vi, type Mock } from 'vitest';
import type { operations } from '@poolmaster/shared/generated';
// A relative path, not the `@poolmaster/shared/generated` alias: that alias resolves to
// api-types.ts itself and so cannot serve a sibling file.
import openapiSpecJson from '../../../../packages/shared/generated/openapi.json?raw';

type HttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put';

interface OperationDefinition {
  method: HttpMethod;
  path: string;
}

interface ApiMockResult {
  data?: unknown;
  error?: unknown;
  response?: {
    status?: number;
  };
  status?: number;
}

type ApiMock = Mock<(options: Record<string, unknown>) => Promise<ApiMockResult> | ApiMockResult>;

/**
 * The operation map, derived from the committed OpenAPI spec (#212).
 *
 * This used to be a hand-written `operationId -> { method, path }` table, and it was a shadow of
 * the spec in the §15 sense: the Fastify registrations are the truth, `openapi.json` is generated
 * from them, and this copy was maintained by eye. It went stale twice — once when `/api/v1/account/*`
 * and `/api/v1/auth/me` were deleted and fifteen entries kept pointing at routes that no longer
 * existed, and again whenever a new route needed an entry that nothing required anyone to add.
 * Nothing failed either time, because a stale entry just mocks a URL no code calls.
 *
 * Now the paths come from the spec and the *names* come from the generated `operations` type, so
 * drift is impossible in both directions: a renamed route moves its path here on the next
 * `npm run api:refresh`, and a mis-typed operation name in `bindApiMocks` is a compile error.
 */
type ApiOperationName = keyof operations;

const HTTP_METHODS = new Set<string>(['delete', 'get', 'patch', 'post', 'put']);

interface SpecOperation {
  operationId?: string;
}

interface OpenApiSpec {
  // A path item also carries non-operation keys such as `parameters`, so the values are
  // `unknown` and the HTTP-method filter below is what narrows them to operations.
  paths?: Record<string, Record<string, unknown>>;
}

function buildOperationDefinitions(): Record<ApiOperationName, OperationDefinition> {
  // `?raw` keeps this a string: importing the 1.8 MB JSON as a module would have TypeScript infer
  // a literal type for the whole spec on every typecheck.
  const spec = JSON.parse(openapiSpecJson) as OpenApiSpec;
  const definitions: Partial<Record<ApiOperationName, OperationDefinition>> = {};

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }
      const operationId = (operation as SpecOperation | null)?.operationId;
      if (!operationId) {
        continue;
      }
      definitions[operationId as ApiOperationName] = {
        method: method as HttpMethod,
        path,
      };
    }
  }

  return definitions as Record<ApiOperationName, OperationDefinition>;
}

const operationDefinitions = buildOperationDefinitions();

function createApiMocks() {
  return Object.fromEntries(
    Object.keys(operationDefinitions).map((operationName) => [
      operationName,
      vi.fn(),
    ]),
  ) as Record<ApiOperationName, ApiMock>;
}

export const mockApi = createApiMocks();

function toMswPath(path: string) {
  return `*${path.replaceAll(/\{([^}]+)\}/g, ':$1')}`;
}

function queryParamsFor(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const query: Record<string, number | string | Array<number | string>> = {};

  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key).map((value) =>
      /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value);
    query[key] = values.length === 1 ? values[0] ?? '' : values;
  }

  return query;
}

async function requestBodyFor(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined;
  }

  const text = await request.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeParams(params: Record<string, readonly string[] | string | undefined>) {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([key, value]) => !/^\d+$/.test(key) && value !== undefined)
      .map(([key, value]) => [
        key,
        Array.isArray(value) ? value[0] : value,
      ]),
  );
}

function statusFor(result: ApiMockResult) {
  if (typeof result.status === 'number') {
    return result.status;
  }
  if (typeof result.response?.status === 'number') {
    return result.response.status;
  }
  if (result.error) {
    const code = typeof result.error === 'object'
      && result.error
      && 'code' in result.error
      && typeof result.error.code === 'string'
      ? result.error.code
      : null;

    return code?.startsWith('AUTH_') || code?.startsWith('ROOT_ADMIN_') ? 401 : 400;
  }
  return 200;
}

function responseFor(result: ApiMockResult | undefined, operationName: ApiOperationName) {
  if (!result) {
    throw new Error(`Unhandled PoolMaster API request in test: ${operationName}`);
  }

  if (result.error) {
    return HttpResponse.json(result.error, { status: statusFor(result) });
  }

  return HttpResponse.json(result.data ?? null, { status: statusFor(result) });
}

function createHandler(operationName: ApiOperationName, definition: OperationDefinition): HttpHandler {
  return http[definition.method](toMswPath(definition.path), async ({ params, request }) => {
    const path = normalizeParams(params);
    const query = queryParamsFor(request);
    const body = await requestBodyFor(request);
    const options = {
      ...(Object.keys(path).length > 0 ? { path } : {}),
      ...(Object.keys(query).length > 0 ? { query } : {}),
      ...(body !== undefined ? { body } : {}),
    };
    const result = await Promise.resolve(mockApi[operationName](options)).catch((error: unknown) => {
      if (operationName === 'logoutUser') {
        return undefined;
      }

      return {
        error: {
          message: error instanceof Error ? error.message : 'Request failed',
        },
        response: { status: 400 },
      };
    });

    if (!result) {
      return HttpResponse.error();
    }

    return responseFor(result, operationName);
  });
}

/**
 * Register the most specific path first, because MSW matches handlers in order (#212).
 *
 * `/leagues/{id}/squads/owner-invitations` and `/leagues/{id}/squads/{squadId}` are both real
 * routes, and whichever is registered first wins: with the wrong order, a request for the
 * invitation list is answered by the get-a-squad mock with `owner-invitations` bound as the squad
 * id. The hand-written map avoided this by accident — it simply had no entry for the route that
 * shadows — which is not a property worth relying on now that every operation in the spec gets a
 * handler. A literal segment beats a parameter at the first position they differ.
 */
function byPathSpecificity(a: OperationDefinition, b: OperationDefinition): number {
  const left = a.path.split('/');
  const right = b.path.split('/');

  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const leftIsParam = left[index]?.startsWith('{') ?? false;
    const rightIsParam = right[index]?.startsWith('{') ?? false;
    if (leftIsParam !== rightIsParam) {
      return leftIsParam ? 1 : -1;
    }
  }

  return a.path.localeCompare(b.path);
}

export const poolmasterApiHandlers = Object.entries(operationDefinitions)
  .sort(([, a], [, b]) => byPathSpecificity(a, b))
  .map(([operationName, definition]) =>
    createHandler(operationName as ApiOperationName, definition),
  );

export const server = setupServer(...poolmasterApiHandlers);

export function resetApiMocks() {
  for (const apiMock of Object.values(mockApi)) {
    apiMock.mockReset();
  }
}

export function bindApiMocks(bindings: Partial<Record<ApiOperationName, ApiMock>>) {
  beforeEach(() => {
    for (const [operationName, apiMock] of Object.entries(bindings)) {
      mockApi[operationName as ApiOperationName].mockImplementation((options) =>
        apiMock(options));
    }
  });
}
