import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findInlineSchemas } from './check-openapi-named-schemas.mjs';

const named = (name) => ({ schema: { $ref: `#/components/schemas/${name}` } });
const inline = { schema: { type: 'object', properties: { success: { type: 'boolean' } } } };

describe('check-openapi-named-schemas (#192)', () => {
  it('passes an operation whose body and every response reference named components', () => {
    const spec = {
      paths: {
        '/things': {
          post: {
            requestBody: { content: { 'application/json': named('CreateThingRequest') } },
            responses: {
              201: { content: { 'application/json': named('ThingResponse') } },
              400: { content: { 'application/json': named('ErrorEnvelope') } },
            },
          },
        },
      },
    };
    assert.deepEqual(findInlineSchemas(spec), []);
  });

  it('passes a response with no content, such as a 204', () => {
    const spec = { paths: { '/things/{id}': { delete: { responses: { 204: { description: 'Deleted' } } } } } };
    assert.deepEqual(findInlineSchemas(spec), []);
  });

  it('fails an inline response schema, naming the operation and status', () => {
    const spec = { paths: { '/things/{id}': { delete: { responses: { 200: { content: { 'application/json': inline } } } } } } };
    assert.deepEqual(findInlineSchemas(spec), [
      { operation: 'DELETE /things/{id}', part: '200 response (application/json)' },
    ]);
  });

  it('fails an inline error response even when the success response is named', () => {
    const spec = {
      paths: {
        '/things': {
          get: {
            responses: {
              200: { content: { 'application/json': named('ThingListResponse') } },
              401: { content: { 'application/json': inline } },
            },
          },
        },
      },
    };
    assert.deepEqual(findInlineSchemas(spec), [
      { operation: 'GET /things', part: '401 response (application/json)' },
    ]);
  });

  it('fails an inline request body', () => {
    const spec = {
      paths: { '/things': { post: { requestBody: { content: { 'application/json': inline } }, responses: {} } } },
    };
    assert.deepEqual(findInlineSchemas(spec), [
      { operation: 'POST /things', part: 'request body (application/json)' },
    ]);
  });

  it('fails a $ref that points somewhere other than a named component', () => {
    const spec = {
      paths: {
        '/things': {
          get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/properties/thing' } } } } } },
        },
      },
    };
    assert.equal(findInlineSchemas(spec).length, 1);
  });
});
