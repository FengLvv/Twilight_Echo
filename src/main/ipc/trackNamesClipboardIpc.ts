import type { IpcMain, IpcMainInvokeEvent } from 'electron'

export function registerTrackNamesClipboardIpc(
  ipc: Pick<IpcMain, 'handle'>,
  services: {
    assertTrusted: (event: IpcMainInvokeEvent, scope: string) => void
    writeText: (text: string) => void
  }
): void {
  ipc.handle('window:copy-track-names', (event, text: unknown) => {
    services.assertTrusted(event, 'track names clipboard')
    if (typeof text !== 'string') throw new Error('Track names must be text')
    services.writeText(text)
  })
}
