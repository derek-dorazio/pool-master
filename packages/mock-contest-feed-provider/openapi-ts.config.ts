import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './generated/openapi.json',
  output: {
    path: './generated/hey-api',
    indexFile: false,
  },
  // core-api imports only the response types (`./generated/hey-api/types`, the package's one
  // export); it calls the feed through its own adapter, never a generated client. So generate
  // the types and nothing else (#539).
  plugins: ['@hey-api/typescript'],
});
