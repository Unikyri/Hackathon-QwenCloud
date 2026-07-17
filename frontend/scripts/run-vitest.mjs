import { accessSync, constants, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

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

  const fallbackDirectory = join(process.cwd(), 'node_modules', '.cache', 'vitest-tmp')
  mkdirSync(fallbackDirectory, { recursive: true })
  return fallbackDirectory
}

const temporaryDirectory = resolveTempDirectory()
const vitestEntrypoint = join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
const result = spawnSync(process.execPath, [vitestEntrypoint, ...process.argv.slice(2)], {
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
