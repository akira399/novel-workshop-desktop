/**
 * Preload — 白名单桥。渲染进程只能通过 window.novelWorkshop.invoke 访问主进程。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { CommandMap, CommandName, CommandRequest, CommandResponse, EventMap, IpcResult } from '@dafuyu/contracts'

export interface NovelWorkshopApi {
  invoke<K extends CommandName>(command: K, payload: CommandRequest<K>): Promise<IpcResult<CommandResponse<K>>>
  on<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void): () => void
  minimize(): void
  maximize(): void
  close(): void
}

const api: NovelWorkshopApi = {
  invoke: (command, payload) => ipcRenderer.invoke('novel:invoke', command, payload),
  on: (event, listener) => {
    const channel = `novel:event:${event}`
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
}

contextBridge.exposeInMainWorld('novelWorkshop', api)
