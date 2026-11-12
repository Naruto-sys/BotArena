import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.BOTARENA_URL ?? 'http://127.0.0.1:5050',
    storageState: process.env.BOTARENA_STORAGE_STATE,
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
  },
});
