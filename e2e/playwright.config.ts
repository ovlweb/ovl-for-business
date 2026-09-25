import { defineConfig, devices } from '@playwright/test';
import { ADMIN_PORT, API_PORT, OWNER_PASSWORD, WEB_PORT } from './constants';

/**
 * Starts the real stack (API server on a fresh database, web client, admin panel)
 * and drives it in Chromium. Needs PostgreSQL (`pnpm db:up` locally, a service in CI).
 */
const serverEnv = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://ovl:ovl@localhost:5432/ovl_e2e',
  JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
  OWNER_USERNAME: 'owner',
  OWNER_EMAIL: 'owner@example.test',
  OWNER_PASSWORD,
  COUNCIL_QUORUM: '1',
  PORT: String(API_PORT),
  LOG_LEVEL: 'warn',
  PUBLIC_WEB_URL: `http://localhost:${WEB_PORT}`,
  PUBLIC_ADMIN_URL: `http://localhost:${ADMIN_PORT}`,
  // The story below predates these rules; the account test covers email links on its own.
  REQUIRE_2FA_FOR_STAFF: 'false',
  REQUIRE_2FA_FOR_COMPANY_FINANCE: 'false',
  REQUIRE_VERIFIED_EMAIL: 'false',
  REQUIRE_IDENTITY_FOR_COMPANIES: 'false',
  // Every browser of the story shares 127.0.0.1; together they pass the per-IP default at peaks.
  GLOBAL_RATE_LIMIT: '5000',
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One story in order: a retry would replay it against data the first run already created.
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 860 } } },
  ],
  webServer: [
    {
      command: 'node --experimental-strip-types reset-db.ts && pnpm --dir ../server exec tsx src/index.ts',
      url: `http://localhost:${API_PORT}/health`,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --dir ../clients/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}/`,
      env: { VITE_DEV_API: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
    },
    {
      command: `pnpm --dir ../admin exec vite --port ${ADMIN_PORT} --strictPort`,
      url: `http://localhost:${ADMIN_PORT}/`,
      env: { VITE_DEV_API: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
    },
  ],
});
