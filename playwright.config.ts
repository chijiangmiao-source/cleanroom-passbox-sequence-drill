import { defineConfig, devices } from '@playwright/test'

// 本地运行时自带 preview 静态服务器；Docker Compose 的 verify 服务通过
// E2E_BASE_URL 指向 compose 中的 web 服务进行验收。
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4173'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    testIdAttribute: 'data-test',
    trace: 'on-first-retry',
    launchOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run preview',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
})
