import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ClosePersistenceAttemptGate,
  closePersistenceDialogOptions,
  closeOnlyAfterRendererPersistence
} from './closePersistence.ts'

test('save failure choices are localized, disclose discard risk and default to preserving data', () => {
  const error = new Error('Core did not confirm final persistence')
  for (const locale of ['zh-CN', 'en-US'] as const) {
    const options = closePersistenceDialogOptions(locale, error)
    assert.equal(options.defaultId, 0)
    assert.equal(options.cancelId, 1)
    assert.equal(options.buttons?.length, 3)
    assert.match(options.detail!, /Core did not confirm final persistence/)
    if (locale === 'zh-CN') {
      assert.deepEqual(options.buttons, ['重试退出', '保留窗口', '不保存退出'])
      assert.match(options.detail!, /可能丢失.*队列、歌单或设置/)
    } else {
      assert.deepEqual(options.buttons, ['Retry quit', 'Keep window open', 'Quit without saving'])
      assert.match(options.detail!, /may lose recent queue, playlist or settings changes/)
    }
    const cleanup = closePersistenceDialogOptions(locale, error, true)
    assert.notEqual(cleanup.title, options.title)
    assert.match(cleanup.message!, locale === 'zh-CN' ? /后台服务/ : /Background services/)
    assert.match(cleanup.detail!, locale === 'zh-CN' ? /已选择跳过/ : /chosen to skip/)
  }
})

test('failed renderer persistence prevents closing the main window', async () => {
  let closeCalls = 0
  let presentedErrorMessage = ''

  const result = await closeOnlyAfterRendererPersistence({
    requestPersistence: async () => {
      throw new Error('playlist write failed')
    },
    close: () => {
      closeCalls += 1
    },
    showFailure: async (error) => {
      presentedErrorMessage = error.message
      return 'cancel'
    }
  })

  assert.equal(result, 'cancelled')
  assert.equal(closeCalls, 0)
  assert.match(presentedErrorMessage, /playlist write failed/)
})

test('renderer persistence timeout prevents closing and offers retry', async () => {
  let closeCalls = 0

  const result = await closeOnlyAfterRendererPersistence({
    requestPersistence: async () => {
      throw new Error('Timed out waiting for renderer persistence')
    },
    close: () => {
      closeCalls += 1
    },
    showFailure: async () => 'retry'
  })

  assert.equal(result, 'retry')
  assert.equal(closeCalls, 0)
})

test('successful renderer persistence closes exactly once', async () => {
  let closeCalls = 0
  const result = await closeOnlyAfterRendererPersistence({
    requestPersistence: async () => {},
    close: () => {
      closeCalls += 1
    },
    showFailure: async () => 'cancel'
  })

  assert.equal(result, 'closed')
  assert.equal(closeCalls, 1)
})

test('retry keeps one close attempt while the next persistence write is in flight', async () => {
  const gate = new ClosePersistenceAttemptGate()
  let persistenceRequests = 0
  let closeCalls = 0
  let resolveSecondPersistence!: () => void
  const secondPersistenceStarted = new Promise<void>((resolve) => {
    resolveSecondPersistence = resolve
  })
  let signalSecondPersistenceStarted!: () => void
  const waitForSecondPersistence = new Promise<void>((resolve) => {
    signalSecondPersistenceStarted = resolve
  })

  const options = {
    requestPersistence: async () => {
      persistenceRequests += 1
      if (persistenceRequests === 1) throw new Error('first write failed')
      signalSecondPersistenceStarted()
      await secondPersistenceStarted
    },
    close: () => {
      closeCalls += 1
    },
    showFailure: async () => 'retry' as const
  }

  const firstClose = gate.run(options)
  await waitForSecondPersistence
  const repeatedClose = gate.run(options)

  assert.strictEqual(repeatedClose, firstClose)
  assert.equal(persistenceRequests, 2)
  assert.equal(closeCalls, 0)

  resolveSecondPersistence()
  assert.equal(await firstClose, 'closed')
  assert.equal(closeCalls, 1)
  assert.equal(persistenceRequests, 2)
})

test('force closes the window even when persistence keeps failing (escape hatch)', async () => {
  let closeCalls = 0

  const result = await closeOnlyAfterRendererPersistence({
    requestPersistence: async () => {
      throw new Error('persistence keeps failing')
    },
    close: () => {
      closeCalls += 1
    },
    showFailure: async () => 'force'
  })

  assert.equal(result, 'closed')
  assert.equal(closeCalls, 1)
})
