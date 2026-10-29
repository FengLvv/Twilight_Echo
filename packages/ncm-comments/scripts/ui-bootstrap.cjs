const { app, BrowserWindow } = require('electron')
if (!process.env.NCM_COMMENTS_TEST_PROFILE || !process.env.NCM_COMMENTS_UI_URL)
  throw new Error('Isolated UI test environment is required')
app.setPath('userData', process.env.NCM_COMMENTS_TEST_PROFILE)
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 420,
    height: 850,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  window.loadURL(process.env.NCM_COMMENTS_UI_URL)
})
app.on('window-all-closed', () => app.quit())
