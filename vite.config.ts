import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.BASE_PATH ? process.env.BASE_PATH.replace(/\/?$/, '/') : '/',
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
