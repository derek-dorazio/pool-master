import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './packages/shared/generated/openapi.json',
  output: {
    path: './packages/shared/generated/hey-api'
  },
  client: '@hey-api/client-fetch',
});
