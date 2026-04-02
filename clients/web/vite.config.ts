import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@poolmaster/shared/api-routes': path.resolve(__dirname, '../../packages/shared/api-routes.ts'),
      '@poolmaster/shared/domain': path.resolve(__dirname, '../../packages/shared/domain/index.ts'),
      '@poolmaster/shared': path.resolve(__dirname, '../../packages/shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
