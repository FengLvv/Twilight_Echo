// Test-only bootstrap. Never falls back to the user's regular profile.
const { app, ipcMain } = require('electron')
const { resolve, join } = require('node:path')
if (!process.env.NCM_COMMENTS_TEST_PROFILE) throw new Error('An isolated test profile is required')
app.setPath('userData', resolve(process.env.NCM_COMMENTS_TEST_PROFILE))
global.__commentsTestConnections = new Map()
global.__commentsTestOperations = []
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  handle(channel, async (...args) => {
    const result = await listener(...args)
    if (channel === 'core-window:request') {
      const operation = args[1]?.request?.payload?.request?.operation
      if (operation) {
        global.__commentsTestOperations.push({
          operation,
          ok: result?.ok,
          result: ['theme', 'heartbeat'].includes(operation) ? result : undefined
        })
        if (global.__commentsTestOperations.length > 30) global.__commentsTestOperations.shift()
      }
    }
    if (channel === 'core-window:connect' && result?.ok)
      global.__commentsTestConnections.set(args[0].sender.id, result.value)
    return result
  })
if (process.env.NCM_COMMENTS_TEST_PACKAGE) {
  const resources = join(resolve(process.env.NCM_COMMENTS_TEST_PACKAGE), 'resources')
  const archive = join(resources, 'app.asar')
  app.setAppPath(archive)
  Object.defineProperty(process, 'resourcesPath', { value: resources })
  require(join(archive, 'out/main/index.js'))
} else require('../../../out/main/index.js')
