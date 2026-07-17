import { basename, resolve } from 'node:path'
import { defineConfig, devices } from '../frontend/node_modules/@playwright/test'

const frontendDir = basename(process.cwd()) === 'frontend'
  ? process.cwd()
  : resolve(process.cwd(), 'frontend')
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:13001'

export default defineConfig({
  testDir: './tests',
  forbidOnly: Boolean(process.env.CI),
  timeout: 180_000,
  expect: { timeout: 90_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5'],
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 13001',
        cwd: frontendDir,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
