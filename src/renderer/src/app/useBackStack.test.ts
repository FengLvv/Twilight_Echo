import assert from 'node:assert/strict'
import test from 'node:test'

const { goBack, pushBackHandler, canGoBack, backHint } = (await import(
  new URL('./useBackStack.ts', import.meta.url).href
)) as typeof import('./useBackStack.ts')

test('stack resolves newest handler first and exposes canGoBack/backHint', () => {
  const order: string[] = []
  const disposePage = pushBackHandler(() => order.push('page'))
  const disposeDetail = pushBackHandler(() => order.push('detail'), '返回推荐')

  assert.equal(canGoBack.value, true)
  assert.equal(backHint.value, '返回推荐')

  assert.equal(goBack(), true)
  assert.deepEqual(order, ['detail'])

  disposeDetail()
  assert.equal(backHint.value, undefined)

  assert.equal(goBack(), true)
  assert.deepEqual(order, ['detail', 'page'])

  disposePage()
  assert.equal(canGoBack.value, false)
  assert.equal(goBack(), false)
})

test('disposer removes its own layer and survives double disposal', () => {
  const order: string[] = []
  const disposeA = pushBackHandler(() => order.push('a'))
  const disposeB = pushBackHandler(() => order.push('b'))
  const disposeC = pushBackHandler(() => {
    order.push('c')
    // Real owners dispose when their layer is gone; without that the handler
    // stays top of stack and would run again on the next back.
    disposeC()
  })

  disposeB()
  disposeB()

  goBack()
  goBack()
  assert.deepEqual(order, ['c', 'a'])

  disposeA()
  assert.equal(canGoBack.value, false)
})

test('handlers that only reduce depth stay registered for the next layer', () => {
  const order: string[] = []
  let depth = 2
  const dispose = pushBackHandler(() => {
    depth -= 1
    order.push(`pop:${depth}`)
  })

  goBack()
  goBack()
  assert.deepEqual(order, ['pop:1', 'pop:0'])
  // Owner decides when the layer is gone, not goBack.
  assert.equal(canGoBack.value, true)
  dispose()
  assert.equal(canGoBack.value, false)
})

test('re-entrant goBack inside a handler is ignored', () => {
  const order: string[] = []
  const disposeA = pushBackHandler(() => order.push('a'))
  const disposeB = pushBackHandler(() => {
    order.push('b')
    goBack()
  })

  assert.equal(goBack(), true)
  assert.deepEqual(order, ['b'])

  disposeB()
  assert.equal(goBack(), true)
  assert.deepEqual(order, ['b', 'a'])

  disposeA()
  assert.equal(canGoBack.value, false)
})
