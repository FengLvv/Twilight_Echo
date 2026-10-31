import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

// Explicit CLI profiles are selected before settings, diagnostics and the instance lock.
const index = process.argv.indexOf('--agent-profile')
if (index >= 0) {
  const value = process.argv[index + 1]
  if (!value || !isAbsolute(value)) throw new Error('--agent-profile requires an absolute directory')
  const profile = resolve(value)
  mkdirSync(profile, { recursive: true })
  app.setPath('userData', profile)
}
