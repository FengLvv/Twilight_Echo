'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/')
function files(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(path.join(directory, entry.name))
        : /\.(?:ts|vue|mjs|cjs)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)
          ? [path.join(directory, entry.name)]
          : []
    )
}

test('portable Core imports only its business layer and shared contracts', () => {
  const violations = []
  for (const file of files(path.join(ROOT, 'src/core'))) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
    function visit(node) {
      const specifier =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) &&
              (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                node.expression.getText(source) === 'require')
            ? node.arguments[0]
            : null
      if (specifier) {
        const spec = ts.isStringLiteral(specifier) ? specifier.text : ''
        const target = spec.startsWith('.') ? rel(path.resolve(path.dirname(file), spec)) : spec
        const portable = /^src\/(?:core|shared)\//.test(target)
        if (!portable) {
          violations.push(`${rel(file)} -> ${target || 'dynamic import target'}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.deepEqual(violations, [])
})

test('Core and shared have no Node.js runtime globals or NodeJS namespace references', () => {
  const nodeGlobals = new Set([
    'Buffer',
    'process',
    'require',
    'setImmediate',
    'clearImmediate',
    '__dirname',
    '__filename',
    'NodeJS'
  ])
  const violations = []
  for (const file of [
    ...files(path.join(ROOT, 'src/core')),
    ...files(path.join(ROOT, 'src/shared'))
  ]) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    )
    function visit(node) {
      if (ts.isIdentifier(node) && nodeGlobals.has(node.text)) {
        const parent = node.parent
        const isDeclarationOrMemberName =
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node) ||
          (ts.isPropertySignature(parent) && parent.name === node) ||
          (ts.isMethodDeclaration(parent) && parent.name === node) ||
          (ts.isMethodSignature(parent) && parent.name === node) ||
          (ts.isParameter(parent) && parent.name === node) ||
          (ts.isVariableDeclaration(parent) && parent.name === node) ||
          (ts.isBindingElement(parent) && parent.name === node) ||
          ts.isImportSpecifier(parent)
        if (!isDeclarationOrMemberName) {
          violations.push(`${rel(file)}: ${node.text}`)
        }
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        ['globalThis', 'global', 'self'].includes(node.expression.getText(source)) &&
        nodeGlobals.has(node.name.text)
      ) {
        violations.push(`${rel(file)}: ${node.getText(source)}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.deepEqual(violations, [])
})

test('Core has no browser storage, DOM or renderer bridge globals', () => {
  const core = files(path.join(ROOT, 'src/core'))
  const program = ts.createProgram(core, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
    allowJs: true,
    noEmit: true
  })
  const checker = program.getTypeChecker(),
    violations = []
  const browser = new Set([
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'navigator',
    'Audio',
    'HTMLAudioElement',
    'HTMLElement',
    'XMLHttpRequest'
  ])
  for (const file of core) {
    const source = program.getSourceFile(file)
    function visit(node) {
      if (
        ts.isIdentifier(node) &&
        browser.has(node.text) &&
        !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      ) {
        const symbol = checker.getSymbolAtLocation(node)
        // Queue controllers use a local variable named window. Only local
        // symbols are permitted; ambient/browser globals are not dependencies.
        if (!symbol?.declarations?.some((declaration) => declaration.getSourceFile() === source))
          violations.push(`${rel(file)}: ${node.text}`)
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        ['globalThis', 'self'].includes(node.expression.getText(source)) &&
        browser.has(node.name.text)
      )
        violations.push(`${rel(file)}: ${node.getText(source)}`)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.deepEqual(violations, [])
})

test('no HTMLAudio playback implementation or environment-variable enablement remains', () => {
  const violations = []
  for (const file of [
    ...files(path.join(ROOT, 'src/renderer')),
    ...files(path.join(ROOT, 'src/main'))
  ]) {
    const source = fs.readFileSync(file, 'utf8')
    if (rel(file) === 'src/renderer/src/stores/player/mediaSessionSentinel.ts') {
      if (/\bTWILIGHT_ENABLE_HTMLAUDIO_FALLBACK\b/.test(source)) violations.push(rel(file))
      continue
    }
    if (
      /\bHTMLAudioElement\b|\bnew\s+(?:window\.)?Audio\s*\(|\bcreateElement\(['"]audio['"]\)|\bTWILIGHT_ENABLE_HTMLAUDIO_FALLBACK\b/.test(
        source
      )
    )
      violations.push(rel(file))
  }
  assert.deepEqual(violations, [])
})

test('all Core domains have zero legacy Node I/O shim consumers', () => {
  const violations = files(path.join(ROOT, 'src/core'))
    .filter((file) => /ports\/index/.test(fs.readFileSync(file, 'utf8')))
    .map(rel)
  assert.deepEqual(violations, [])
  assert.equal(fs.existsSync(path.join(ROOT, 'src/core/ports/index.ts')), false)
  assert.equal(fs.existsSync(path.join(ROOT, 'src/adapters-node/index.ts')), false)
})

test('domain contracts contain no executable implementation or registration', () => {
  const violations = []
  for (const file of files(path.join(ROOT, 'src/core')).filter((f) =>
    /(?:Port|Contract)\.ts$/.test(f)
  )) {
    const emitted = ts
      .transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
      })
      .outputText.trim()
    if (emitted && emitted !== 'export {};') violations.push(rel(file))
  }
  assert.deepEqual(violations, [])
})
