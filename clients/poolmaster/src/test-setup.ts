import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { resetApiMocks, server } from './test/msw-api';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  resetApiMocks();
});

afterAll(() => {
  server.close();
});

// jsdom does not implement scrollIntoView; every browser the app supports does.
Element.prototype.scrollIntoView = () => undefined;
