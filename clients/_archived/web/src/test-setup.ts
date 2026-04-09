import '@testing-library/jest-dom/vitest';
import { server } from './test/msw/server';
import { afterAll, afterEach, beforeAll } from 'vitest';

// Start MSW server before all tests — intercepts fetch at the network level.
// onUnhandledRequest: 'warn' logs unhandled requests but doesn't fail tests
// (use 'error' once all handlers are in place for full enforcement).
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
