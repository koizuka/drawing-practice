import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.BUILD_DATE': JSON.stringify(new Date().toISOString()),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Pin the test runner's timezone so date-bucketing tests
    // (galleryGrouping) don't depend on the developer's local TZ.
    env: {
      TZ: 'UTC',
    },
    server: {
      deps: {
        // Inline @mui/material so Vite resolves its internal directory import
        // of `react-transition-group/TransitionGroupContext` (MUI 9.1.0+).
        // Node's native ESM loader can't resolve that bare directory import
        // when the package is externalized, breaking every component test.
        inline: ['@mui/material'],
      },
    },
  },
});
