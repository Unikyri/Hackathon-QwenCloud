import { accessSync, constants, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

function hasWritableDirectory(directory) {
  if (!directory) return false

  try {
    accessSync(directory, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function resolveTempDirectory() {
  const configuredDirectory = process.env.TMPDIR ?? process.env.TMP ?? process.env.TEMP
  if (hasWritableDirectory(configuredDirectory)) return configuredDirectory

  const fallbackDirectory = join(process.cwd(), 'node_modules', '.cache', 'playwright-tmp')
  mkdirSync(fallbackDirectory, { recursive: true })
  return fallbackDirectory
}

const temporaryDirectory = resolveTempDirectory()
const playwrightEntrypoint = join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js')
const result = spawnSync(process.execPath, [playwrightEntrypoint, ...process.argv.slice(2)], {
  env: {
    ...process.env,
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
  },
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
