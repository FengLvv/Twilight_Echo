import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { registeredCoreOperations } from './router.ts'

test('each public Core operation has exactly one domain handler or an explicit playback admission gate', () => {
  const source = ts.createSourceFile('protocol.ts', readFileSync(new URL('../../shared/coreProtocol.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]).find(d => d.name.getText(source) === 'OPERATIONS')!
  assert.ok(ts.isObjectLiteralExpression(declaration.initializer!))
  const operations = (declaration.initializer as ts.ObjectLiteralExpression).properties.map(p => (p.name as ts.StringLiteral).text)
  const delegated = ['liked.play', 'heart.refill', 'personalized.start', 'personalized.refill']
  assert.equal(new Set(registeredCoreOperations).size, registeredCoreOperations.length)
  assert.deepEqual([...registeredCoreOperations, ...delegated].sort(), operations.sort())
})
