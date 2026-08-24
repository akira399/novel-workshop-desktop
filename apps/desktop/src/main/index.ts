/**
 * 大肥鱼的小说工坊 — Electron 主进程入口。
 * 职责：创建窗口、安全 IPC、WorkspaceService、工作区选择、自更新挂载点。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { WorkspaceService } from './workspace-service.ts'
import type { CommandName, CommandRequest, CommandResponse, IpcResult, AppInfo, AppSettings } from '@dafuyu/contracts'
import { toPluginError } from '@dafuyu/contracts'

const APP_NAME = '大肥鱼的小说工坊'

let mainWindow: BrowserWindow | null = null
let workspaceService: WorkspaceService | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function loadSettings(): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

async function saveSettings(settings: Record<string, unknown>): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

function resolveResourcesDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'resources')
  return resolve(__dirname, '../../../resources')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: APP_NAME,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function dispatch<K extends CommandName>(command: K, payload: CommandRequest<K>): Promise<IpcResult<CommandResponse<K>>> {
  try {
    const ws = workspaceService
    switch (command) {
      case 'app:getInfo': {
        const info: AppInfo = {
          appName: APP_NAME,
          version: app.getVersion(),
          contractsVersion: '0.1.0',
          workspacePath: ws?.getWorkspacePath() ?? null,
          electron: process.versions.electron ?? '',
          node: process.versions.node ?? '',
          platform: process.platform,
        }
        return { ok: true, value: info as CommandResponse<K> }
      }
      case 'workspace:get':
        return { ok: true, value: (await ws?.getWorkspaceInfo() ?? null) as CommandResponse<K> }
      case 'workspace:choose': {
        if (!mainWindow) return { ok: false, error: { code: 'IO_FAILURE', message: '主窗口未就绪' } }
        const result = await dialog.showOpenDialog(mainWindow, {
          title: '选择小说工坊工作区',
          properties: ['openDirectory', 'createDirectory'],
        })
        if (result.canceled || result.filePaths.length === 0) return { ok: true, value: null as CommandResponse<K> }
        const path = result.filePaths[0]!
        const info = await ws!.setWorkspace(path)
        return { ok: true, value: info as CommandResponse<K> }
      }
      case 'workspace:set': {
        const req = payload as { path: string }
        const info = await ws!.setWorkspace(req.path)
        return { ok: true, value: info as CommandResponse<K> }
      }
      case 'projects:list':
        return { ok: true, value: (await ws!.listProjects()) as CommandResponse<K> }
      case 'projects:create': {
        const req = payload as { title: string; genre: string }
        return { ok: true, value: (await ws!.createProject(req.title, req.genre)) as CommandResponse<K> }
      }
      case 'projects:get': {
        const req = payload as { id: string }
        return { ok: true, value: (await ws!.getProject(req.id)) as CommandResponse<K> }
      }
      case 'projects:delete': {
        const req = payload as { id: string; keepChapters: boolean }
        return { ok: true, value: (await ws!.deleteProject(req.id, req.keepChapters)) as CommandResponse<K> }
      }
      case 'projects:listArtifacts': {
        const req = payload as { id: string }
        return { ok: true, value: (await ws!.listArtifacts(req.id)) as CommandResponse<K> }
      }
      case 'chapters:list': {
        const req = payload as { projectId: string }
        return { ok: true, value: (await ws!.listChapters(req.projectId)) as CommandResponse<K> }
      }
      case 'chapters:get': {
        const req = payload as { projectId: string; chapterNo: number }
        return { ok: true, value: (await ws!.getChapter(req.projectId, req.chapterNo)) as CommandResponse<K> }
      }
      case 'chapters:save': {
        const req = payload as { projectId: string; chapterNo: number; title: string; text: string; brief?: string }
        return { ok: true, value: (await ws!.saveChapter(req.projectId, req.chapterNo, req.title, req.text, req.brief)) as CommandResponse<K> }
      }
      case 'chapters:stats': {
        const req = payload as { projectId: string; chapterNo: number }
        return { ok: true, value: (await ws!.chapterStats(req.projectId, req.chapterNo)) as CommandResponse<K> }
      }
      case 'lorebook:list': {
        const req = payload as { bookId?: string }
        return { ok: true, value: (await ws!.listLorebook(req.bookId)) as CommandResponse<K> }
      }
      case 'lorebook:saveEntry': {
        const req = payload as { entry: import('@dafuyu/core/types').LoreEntry }
        return { ok: true, value: (await ws!.saveLoreEntry(req.entry)) as CommandResponse<K> }
      }
      case 'lorebook:deleteEntry': {
        const req = payload as { id: string }
        await ws!.deleteLoreEntry(req.id)
        return { ok: true, value: undefined as CommandResponse<K> }
      }
      case 'lorebook:importJson': {
        const req = payload as { content: string; bookId?: string }
        return { ok: true, value: (await ws!.importLorebookJson(req.content, req.bookId)) as CommandResponse<K> }
      }
      case 'prompts:list':
        return { ok: true, value: (await ws!.listPrompts()) as CommandResponse<K> }
      case 'settings:get': {
        const settings = await loadSettings()
        return { ok: true, value: settings as AppSettings as CommandResponse<K> }
      }
      case 'settings:set': {
        const req = payload as { settings: AppSettings }
        await saveSettings({ ...(await loadSettings()), ...req.settings })
        return { ok: true, value: req.settings as CommandResponse<K> }
      }
      default:
        return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: `未实现命令: ${String(command)}` } }
    }
  } catch (error) {
    return { ok: false, error: toPluginError(error) }
  }
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  workspaceService = new WorkspaceService({
    resourcesDir: resolveResourcesDir(),
    loadSettings,
    saveSettings,
  })
  await workspaceService.init()
  createWindow()

  ipcMain.handle('novel:invoke', async (_event, command: string, payload: unknown) => {
    return dispatch(command as CommandName, payload as never)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

void bootstrap().catch((error) => {
  console.error('[novel-workshop] bootstrap failed', error)
  app.quit()
})
