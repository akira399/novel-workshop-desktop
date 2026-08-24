/**
 * Preload — 白名单桥。渲染进程只能通过 window.novelWorkshop.invoke 访问主进程。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { CommandMap, CommandName, CommandRequest, CommandResponse, IpcResult } from '@dafuyu/contracts'

export interface NovelWorkshopApi {
  invoke<K extends CommandName>(command: K, payload: CommandRequest<K>): Promise<IpcResult<CommandResponse<K>>>
  on<K extends CommandName>(command: K, listener: (payload: CommandResponse<K>) => void): () => void
}

const api: NovelWorkshopApi = {
  invoke: (command, payload) => ipcRenderer.invoke('novel:invoke', command, payload),
  on: (command, listener) => {
    const channel = `novel:event:${command}`
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
}

contextBridge.exposeInMainWorld('novelWorkshop', api)
