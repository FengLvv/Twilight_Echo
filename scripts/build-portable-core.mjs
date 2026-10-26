import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ENTRY = path.join(ROOT, 'src/core/portableSlice.ts')
const OUT_DIR = path.join(ROOT, 'dist/portable-core')
const OUT_FILE = path.join(OUT_DIR, 'music-core.js')
const LOCK_FILE = path.join(OUT_DIR, 'core-lock.json')

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  await build({
    root: ROOT,
    logLevel: 'warn',
    configFile: false,
    build: {
      outDir: OUT_DIR,
      emptyOutDir: false,
      sourcemap: true,
      minify: false,
      target: 'es2022',
      lib: {
        entry: ENTRY,
        name: 'TwilightPortableCore',
        formats: ['iife'],
        fileName: () => 'music-core.js'
      },
      rollupOptions: {
        external: [],
        onwarn(warning, warn) {
          if (warning.code === 'CIRCULAR_DEPENDENCY') return
          warn(warning)
        }
      }
    }
  })

  if (!fs.existsSync(OUT_FILE)) {
    throw new Error(`Expected portable Core bundle was not produced at ${OUT_FILE}`)
  }

  const bundleCode = fs.readFileSync(OUT_FILE, 'utf8')

  // Verify the bundle has zero Node.js runtime imports, require() calls, or Legacy Node I/O shim references
  const forbiddenPatterns = [
    { pattern: /\bnode:[a-z0-9_/]+\b/i, reason: 'node:* builtin module reference' },
    { pattern: /__TWILIGHT_CORE_PORTS__/, reason: 'Legacy Node I/O shim (__TWILIGHT_CORE_PORTS__)' },
    { pattern: /\brequire\s*\(/, reason: 'CommonJS require() call' }
  ]

  for (const { pattern, reason } of forbiddenPatterns) {
    if (pattern.test(bundleCode)) {
      throw new Error(`Portable Core bundle validation failed: found forbidden ${reason}`)
    }
  }

  const sha256 = crypto.createHash('sha256').update(bundleCode, 'utf8').digest('hex')
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

  const lockMetadata = {
    upstream: 'https://github.com/Px-asen/Twilight_Echo',
    commit: '65688cccf919cbf36d900e92fd0a06eb4fb557c0',
    musicCoreVersion: pkg.version ?? '1.4.0-perview',
    audioCoreVersion: '0.1.0',
    protocolVersion: 1,
    hostApiVersion: '1.0.0',
    nativeAbiVersion: '0.1.0',
    bundleFile: 'music-core.js',
    bundleSha256: sha256,
    bundleBytes: Buffer.byteLength(bundleCode, 'utf8')
  }

  fs.writeFileSync(LOCK_FILE, `${JSON.stringify(lockMetadata, null, 2)}\n`, 'utf8')

  const androidTargets = [
    path.join(ROOT, 'sdk/android-app'),
    path.resolve(ROOT, '../Twilight_Echo_Android')
  ]
  for (const androidAppRoot of androidTargets) {
    if (fs.existsSync(androidAppRoot)) {
      const androidAssetsCoreDir = path.join(androidAppRoot, 'runtime-host/src/main/assets/core')
      fs.mkdirSync(androidAssetsCoreDir, { recursive: true })
      fs.copyFileSync(OUT_FILE, path.join(androidAssetsCoreDir, 'music-core.js'))
      fs.copyFileSync(LOCK_FILE, path.join(androidAssetsCoreDir, 'core-lock.json'))
      fs.copyFileSync(LOCK_FILE, path.join(androidAppRoot, 'core-lock.json'))
    }
  }

  console.log(
    `[portable-core] Built ${ path.relative(ROOT, OUT_FILE) } (${lockMetadata.bundleBytes} bytes, sha256=${sha256.slice(0, 12)}...)`
  )
}

main().catch((error) => {
  console.error('[portable-core] Build failed:', error)
  process.exitCode = 1
})
