import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerTrackNamesClipboardIpc } from './trackNamesClipboardIpc.ts'

test('track names clipboard validates the sender and text before writing complete selections', () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value?: unknown) => unknown>()
  const ipc = { handle: (channel, handler) => handlers.set(channel, handler) } as Pick<
    IpcMain,
    'handle'
  >
  const event = {} as IpcMainInvokeEvent
  const writes: string[] = []
  let trusted = true
  registerTrackNamesClipboardIpc(ipc, {
    assertTrusted: (received, scope) => {
      assert.equal(received, event)
      assert.equal(scope, 'track names clipboard')
      if (!trusted) throw new Error('Untrusted')
    },
    writeText: (text) => {
      writes.push(text)
    }
  })
  const copy = (value: unknown) => handlers.get('window:copy-track-names')!(event, value)
  for (const value of [undefined, null, 42, ['Song - Artist'], { text: 'Song - Artist' }])
    assert.throws(() => copy(value), /must be text/)
  assert.deepEqual(writes, [])
  const text = Array.from({ length: 605 }, (_, i) => `歌曲 ${i} - 作者`).join('\n')
  copy(text)
  assert.deepEqual(writes, [text])
  trusted = false
  assert.throws(() => copy(text), /Untrusted/)
  assert.deepEqual(writes, [text])
  assert.equal(handlers.size, 1, 'the bridge must not expose clipboard reading')
})

test('native clipboard failures reject the request', () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value?: unknown) => unknown>()
  const ipc = { handle: (channel, handler) => handlers.set(channel, handler) } as Pick<
    IpcMain,
    'handle'
  >
  registerTrackNamesClipboardIpc(ipc, {
    assertTrusted: () => {},
    writeText: () => {
      throw new Error('Clipboard unavailable')
    }
  })
  assert.throws(
    () => handlers.get('window:copy-track-names')!({} as IpcMainInvokeEvent, 'Song - Artist'),
    /Clipboard unavailable/
  )
})
