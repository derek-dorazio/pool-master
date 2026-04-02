import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './generated/openapi.json',
  output: {
    path: './generated/hey-api'
  },
  client: '@hey-api/client-fetch',
});
