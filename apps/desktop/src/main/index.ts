/**
 * 大肥鱼的小说工坊 — Electron 主进程入口。
 * 职责：创建窗口、安全 IPC、WorkspaceService、工作区选择、自更新挂载点。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater
import { join, resolve, extname } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { WorkspaceService } from './workspace-service.ts'
import { ModelService } from './model-service.ts'
import { AgentService } from './agent-service.ts'
import { ExportService } from './export-service.ts'
import { SyncService } from './sync-service.ts'
import type { CommandName, CommandRequest, CommandResponse, IpcResult, AppInfo, AppSettings, ModelProfile } from '@dafuyu/contracts'
import { toPluginError } from '@dafuyu/contracts'

const APP_NAME = '大肥鱼的小说工坊'

let mainWindow: BrowserWindow | null = null
let workspaceService: WorkspaceService | null = null
let modelService: ModelService | null = null
let agentService: AgentService | null = null
let exportService: ExportService | null = null
let syncService: SyncService | null = null

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
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
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
      case 'projects:clone': {
        const req = payload as { sourceId: string; title?: string; genre?: string }
        return { ok: true, value: (await ws!.cloneProject(req.sourceId, { title: req.title, genre: req.genre })) as CommandResponse<K> }
      }
      case 'projects:phase': {
        const req = payload as { projectId: string; phase?: import('@dafuyu/core/workflow').PhaseId }
        const book = req.phase ? await ws!.enterPhase(req.projectId, req.phase) : await ws!.getProject(req.projectId)
        return { ok: true, value: book as CommandResponse<K> }
      }
      case 'projects:commit': {
        const req = payload as { projectId: string; phase: import('@dafuyu/core/workflow').PhaseId; artifact: string; errorCount?: number; warningCount?: number; passed?: boolean }
        const errorCount = req.errorCount ?? 0
        const book = await ws!.commitPhase(req.projectId, req.phase, req.artifact, {
          passed: req.passed ?? errorCount === 0,
          errorCount,
          warningCount: req.warningCount ?? 0,
        })
        return { ok: true, value: book as CommandResponse<K> }
      }
      case 'projects:override': {
        const req = payload as { projectId: string; phase: import('@dafuyu/core/workflow').PhaseId; action: 'force' | 'reopen' | 'skip' | 'rollback' }
        return { ok: true, value: (await ws!.overridePhase(req.projectId, req.phase, req.action)) as CommandResponse<K> }
      }
      case 'projects:audit': {
        const req = payload as { projectId: string }
        return { ok: true, value: (await ws!.audit(req.projectId)) as CommandResponse<K> }
      }
      case 'projects:stats': {
        const req = payload as { projectId: string }
        return { ok: true, value: (await ws!.projectStats(req.projectId)) as CommandResponse<K> }
      }
      case 'projects:importText': {
        const req = payload as { text: string; title?: string; genre?: string; fileName?: string }
        return { ok: true, value: (await ws!.importText(req.text, { title: req.title, genre: req.genre, fileName: req.fileName })) as CommandResponse<K> }
      }
      case 'projects:importFile': {
        if (!mainWindow) return { ok: false, error: { code: 'IO_FAILURE', message: '主窗口未就绪' } }
        const result = await dialog.showOpenDialog(mainWindow, {
          title: '导入本地书籍文件',
          properties: ['openFile'],
          filters: [{ name: '文本文件', extensions: ['txt', 'md', 'markdown'] }],
        })
        if (result.canceled || result.filePaths.length === 0) return { ok: true, value: null as CommandResponse<K> }
        const filePath = result.filePaths[0]!
        const fileName = filePath.split(/[\\/]/).at(-1) ?? 'import.txt'
        const content = await readFile(filePath, 'utf8')
        return { ok: true, value: (await ws!.importText(content, { fileName })) as CommandResponse<K> }
      }
      case 'projects:importDemo':
        return { ok: true, value: (await ws!.importDemo()) as CommandResponse<K> }
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
      case 'chapters:assemble': {
        const req = payload as { projectId: string; chapterNo: number; brief?: string }
        return { ok: true, value: (await ws!.assembleContext(req.projectId, req.chapterNo, req.brief)) as CommandResponse<K> }
      }
      case 'chapters:validate': {
        const req = payload as { projectId: string; chapterNo: number; title: string; text: string; brief?: string }
        return { ok: true, value: (await ws!.validateChapter(req.projectId, req.chapterNo, req.title, req.text, req.brief)) as CommandResponse<K> }
      }
      case 'chapters:diagnose': {
        const req = payload as { projectId: string; chapterStart: number; count?: number }
        return { ok: true, value: (await ws!.diagnoseChapters(req.projectId, req.chapterStart, req.count)) as CommandResponse<K> }
      }
      case 'chapters:wordcount': {
        const req = payload as { text: string; min?: number; max?: number; useCjk?: boolean }
        return { ok: true, value: ws!.wordcount(req.text, req.min, req.max, req.useCjk) as CommandResponse<K> }
      }
      case 'chapters:export': {
        const req = payload as { projectId: string; format: 'txt' | 'markdown' | 'platform'; authorNotes?: string; splitVolumes?: boolean }
        return { ok: true, value: (await ws!.exportProject(req.projectId, req.format, { authorNotes: req.authorNotes, splitVolumes: req.splitVolumes })) as CommandResponse<K> }
      }
      case 'chapters:exportToFile': {
        const req = payload as { projectId: string; format: 'txt' | 'markdown' | 'platform'; authorNotes?: string; splitVolumes?: boolean }
        if (!mainWindow) return { ok: false, error: { code: 'IO_FAILURE', message: '主窗口未就绪' } }
        const exported = await ws!.exportProject(req.projectId, req.format, { authorNotes: req.authorNotes, splitVolumes: req.splitVolumes })
        const result = await dialog.showSaveDialog(mainWindow, {
          title: '导出成稿',
          defaultPath: exported.fileName,
          filters: [{ name: '文本', extensions: ['txt', 'md'] }],
        })
        if (result.canceled || !result.filePath) return { ok: true, value: { path: '' } as CommandResponse<K> }
        await writeFile(result.filePath, exported.content, 'utf8')
        return { ok: true, value: { path: result.filePath } as CommandResponse<K> }
      }
      case 'export:file': {
        const req = payload as { projectId: string; format: 'epub' | 'pdf' | 'docx'; path?: string }
        if (!mainWindow) return { ok: false, error: { code: 'IO_FAILURE', message: '主窗口未就绪' } }
        const ext = req.format === 'epub' ? 'epub' : req.format === 'pdf' ? 'pdf' : 'docx'
        const defaultName = await exportService!.defaultFileName(req.projectId, ext)
        let target = req.path
        if (!target) {
          const result = await dialog.showSaveDialog(mainWindow, {
            title: `导出 ${req.format.toUpperCase()}`,
            defaultPath: defaultName,
            filters: [{ name: req.format.toUpperCase(), extensions: [ext] }],
          })
          if (result.canceled || !result.filePath) return { ok: true, value: { path: '' } as CommandResponse<K> }
          target = result.filePath
        }
        if (req.format === 'epub') await exportService!.exportEpub(req.projectId, target)
        else if (req.format === 'pdf') await exportService!.exportPdf(req.projectId, target)
        else await exportService!.exportDocx(req.projectId, target)
        return { ok: true, value: { path: target } as CommandResponse<K> }
      }
      case 'polish:split': {
        const req = payload as { original: string; polished: string }
        return { ok: true, value: ws!.splitPolish(req.original, req.polished) as CommandResponse<K> }
      }
      case 'polish:apply': {
        const req = payload as { original: string; suggestions: import('@dafuyu/core/polish').PolishSuggestion[] }
        return { ok: true, value: ws!.applyPolish(req.original, req.suggestions) as CommandResponse<K> }
      }
      case 'polish:aiTasteScan': {
        const req = payload as { text: string }
        return { ok: true, value: ws!.aiTasteScan(req.text) as CommandResponse<K> }
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
      case 'lorebook:exportSillyTavern':
        return { ok: true, value: (await ws!.exportLorebookSillyTavern()) as CommandResponse<K> }
      case 'lorebook:autogen': {
        const req = payload as { bookId: string; profileId?: string }
        return { ok: true, value: (await agentService!.autogenLorebook(req.bookId, req.profileId)) as CommandResponse<K> }
      }
      case 'lorebook:listGroups':
        return { ok: true, value: (await ws!.listLorebookGroups()) as CommandResponse<K> }
      case 'lorebook:createGroup': {
        const req = payload as { name: string; entry_ids?: string[]; book_ids?: string[]; enabled?: boolean }
        return { ok: true, value: (await ws!.createLoreGroup(req)) as CommandResponse<K> }
      }
      case 'lorebook:updateGroup': {
        const req = payload as import('@dafuyu/core/lorebook').UpdateGroupParams
        return { ok: true, value: (await ws!.updateLoreGroup(req)) as CommandResponse<K> }
      }
      case 'lorebook:deleteGroup': {
        const req = payload as { id: string; deleteEntries?: boolean }
        return { ok: true, value: (await ws!.deleteLoreGroup(req.id, req.deleteEntries ?? false)) as CommandResponse<K> }
      }
      case 'lorebook:moveEntry': {
        const req = payload as { entryId: string; targetGroupId?: string }
        return { ok: true, value: (await ws!.moveLoreEntry(req.entryId, req.targetGroupId)) as CommandResponse<K> }
      }
      case 'prompts:list':
        return { ok: true, value: (await ws!.listPrompts()) as CommandResponse<K> }
      case 'extras:foreshadows': {
        const req = payload as { projectId: string }
        return { ok: true, value: (await ws!.listForeshadows(req.projectId)) as CommandResponse<K> }
      }
      case 'extras:plantForeshadow': {
        const req = payload as { projectId: string; content: string; plantChapter: number; plannedRevealChapter?: number; related?: string }
        return { ok: true, value: (await ws!.plantForeshadow(req.projectId, req)) as CommandResponse<K> }
      }
      case 'extras:revealForeshadow': {
        const req = payload as { projectId: string; id: string; chapterNo: number }
        return { ok: true, value: (await ws!.revealForeshadow(req.projectId, req.id, req.chapterNo)) as CommandResponse<K> }
      }
      case 'extras:dropForeshadow': {
        const req = payload as { projectId: string; id: string }
        return { ok: true, value: (await ws!.dropForeshadow(req.projectId, req.id)) as CommandResponse<K> }
      }
      case 'extras:glossary': {
        const req = payload as { projectId: string }
        return { ok: true, value: (await ws!.listGlossary(req.projectId)) as CommandResponse<K> }
      }
      case 'extras:addGlossary': {
        const req = payload as { projectId: string; term: string; definition: string; category?: string }
        return { ok: true, value: (await ws!.addGlossary(req.projectId, req.term, req.definition, req.category)) as CommandResponse<K> }
      }
      case 'extras:extractGlossary': {
        const req = payload as { text: string }
        return { ok: true, value: ws!.extractGlossaryCandidates(req.text) as CommandResponse<K> }
      }
      case 'extras:ideas': {
        const req = payload as { projectId: string; query?: string }
        return { ok: true, value: (await ws!.listIdeas(req.projectId, req.query)) as CommandResponse<K> }
      }
      case 'extras:addIdea': {
        const req = payload as { projectId: string; content: string; tags?: string[] }
        return { ok: true, value: (await ws!.addIdea(req.projectId, req.content, req.tags)) as CommandResponse<K> }
      }
      case 'extras:ledger': {
        const req = payload as { projectId: string; entity?: string }
        return { ok: true, value: (await ws!.ledger(req.projectId, req.entity)) as CommandResponse<K> }
      }
      case 'extras:timeline': {
        const req = payload as { projectId: string }
        return { ok: true, value: (await ws!.timeline(req.projectId)) as CommandResponse<K> }
      }
      case 'extras:recordTimeline': {
        const req = payload as { projectId: string; chapterNo: number; bookTime: string; event: string }
        return { ok: true, value: (await ws!.recordTimeline(req.projectId, req)) as CommandResponse<K> }
      }
      case 'extras:consistencyAudit': {
        const req = payload as { projectId: string }
        return { ok: true, value: (await ws!.consistencyAudit(req.projectId)) as CommandResponse<K> }
      }
      case 'guide:parseIntent': {
        const req = payload as { text: string }
        return { ok: true, value: ws!.parseIntent(req.text) as CommandResponse<K> }
      }
      case 'guide:wizardStatus': {
        const req = payload as { projectId: string }
        return { ok: true, value: (await ws!.wizardStatus(req.projectId)) as CommandResponse<K> }
      }
      case 'guide:wizardAction': {
        const req = payload as { projectId: string; action: 'commit' | 'next' | 'skip'; step?: import('@dafuyu/core/guide').WizardState['step']; artifact?: string }
        return { ok: true, value: (await ws!.wizardAction(req.projectId, req.action, req.step, req.artifact)) as CommandResponse<K> }
      }
      case 'library:list': {
        const req = payload as { kind?: 'material' | 'skill'; query?: string }
        return { ok: true, value: (await ws!.listLibrary(req)) as CommandResponse<K> }
      }
      case 'library:save': {
        const req = payload as { entry: import('@dafuyu/contracts').LibraryEntry }
        return { ok: true, value: (await ws!.saveLibraryEntry(req.entry)) as CommandResponse<K> }
      }
      case 'library:delete': {
        const req = payload as { id: string }
        await ws!.deleteLibraryEntry(req.id)
        return { ok: true, value: undefined as CommandResponse<K> }
      }
      case 'sync:status':
        return { ok: true, value: (await syncService!.status()) as CommandResponse<K> }
      case 'sync:saveConfig': {
        const req = payload as { config: import('@dafuyu/contracts').SyncConfig }
        await syncService!.saveConfig(req.config)
        return { ok: true, value: undefined as CommandResponse<K> }
      }
      case 'sync:test':
        return { ok: true, value: (await syncService!.test()) as CommandResponse<K> }
      case 'sync:push':
        return { ok: true, value: (await syncService!.push()) as CommandResponse<K> }
      case 'sync:pull':
        return { ok: true, value: (await syncService!.pull()) as CommandResponse<K> }
      case 'reader:open': {
        if (!mainWindow) return { ok: false, error: { code: 'IO_FAILURE', message: '主窗口未就绪' } }
        const result = await dialog.showOpenDialog(mainWindow, {
          title: '打开本地读物',
          properties: ['openFile'],
          filters: [
            { name: '文本/PDF/EPUB', extensions: ['txt', 'md', 'markdown', 'pdf', 'epub'] },
          ],
        })
        if (result.canceled || result.filePaths.length === 0) return { ok: true, value: { path: '', ext: '', text: null, openedExternal: false } as CommandResponse<K> }
        const filePath = result.filePaths[0]!
        const ext = extname(filePath).toLowerCase().replace('.', '')
        if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
          const text = await readFile(filePath, 'utf8')
          return { ok: true, value: { path: filePath, ext, text, openedExternal: false } as CommandResponse<K> }
        }
        void shell.openPath(filePath)
        return { ok: true, value: { path: filePath, ext, text: null, openedExternal: true } as CommandResponse<K> }
      }
      case 'update:check':
        return { ok: true, value: (await checkForUpdates()) as CommandResponse<K> }
      case 'update:download': {
        try {
          autoUpdater.autoDownload = true
          void autoUpdater.downloadUpdate()
          return { ok: true, value: { started: true } as CommandResponse<K> }
        } catch (error) {
          return { ok: false, error: toPluginError(error) }
        }
      }
      case 'models:list':
        return { ok: true, value: (await modelService!.list()) as CommandResponse<K> }
      case 'models:save': {
        const req = payload as { profile: ModelProfile }
        return { ok: true, value: (await modelService!.save(req.profile)) as CommandResponse<K> }
      }
      case 'models:delete': {
        const req = payload as { id: string }
        await modelService!.delete(req.id)
        return { ok: true, value: undefined as CommandResponse<K> }
      }
      case 'models:test': {
        const req = payload as { id: string }
        return { ok: true, value: (await modelService!.test(req.id)) as CommandResponse<K> }
      }
      case 'models:fetch': {
        const req = payload as { provider: ModelProfile['provider']; baseUrl?: string; apiKey?: string }
        return { ok: true, value: (await modelService!.fetchModels(req.provider, req.baseUrl, req.apiKey)) as CommandResponse<K> }
      }
      case 'agent:complete': {
        const req = payload as { profileId?: string; messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; temperature?: number; maxTokens?: number }
        return { ok: true, value: (await modelService!.complete(req.profileId, req.messages, { temperature: req.temperature, maxTokens: req.maxTokens })) as CommandResponse<K> }
      }
      case 'agent:writeChapter': {
        const req = payload as { projectId: string; chapterNo: number; brief?: string; profileId?: string }
        return { ok: true, value: (await agentService!.writeChapter(req.projectId, req.chapterNo, req.brief, req.profileId)) as CommandResponse<K> }
      }
      case 'agent:polish': {
        const req = payload as { projectId: string; chapterNo: number; text?: string; instruction?: string; profileId?: string }
        return { ok: true, value: (await agentService!.polish(req.projectId, req.chapterNo, req.text, req.instruction, req.profileId)) as CommandResponse<K> }
      }
      case 'agent:depolish': {
        const req = payload as { text: string; profileId?: string }
        return { ok: true, value: (await agentService!.depolish(req.text, req.profileId)) as CommandResponse<K> }
      }
      case 'agent:styleConvert': {
        const req = payload as { projectId: string; chapterNo: number; styleId: string; profileId?: string }
        return { ok: true, value: (await agentService!.styleConvert(req.projectId, req.chapterNo, req.styleId, req.profileId)) as CommandResponse<K> }
      }
      case 'agent:revise': {
        const req = payload as { projectId: string; chapterNo: number; mode: 'proofread' | 'rhythm' | 'style'; profileId?: string }
        return { ok: true, value: (await agentService!.revise(req.projectId, req.chapterNo, req.mode, req.profileId)) as CommandResponse<K> }
      }
      case 'agent:applyAdvice': {
        const req = payload as { text: string; advice: string; profileId?: string }
        return { ok: true, value: (await agentService!.applyAdvice(req.text, req.advice, req.profileId)) as CommandResponse<K> }
      }
      case 'agent:marketResearch': {
        const req = payload as { genre: string; topic?: string; profileId?: string }
        return { ok: true, value: (await agentService!.marketResearch(req.genre, req.topic ?? '', req.profileId)) as CommandResponse<K> }
      }
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

let updateAvailableVersion: string | null = null

function initAutoUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.on('update-available', (info) => {
    updateAvailableVersion = info.version
  })
  autoUpdater.on('error', (_error) => {
    // 开发环境无发布源时报错是正常的
  })
}

async function checkForUpdates(): Promise<{ status: 'checking' | 'available' | 'not-available' | 'error'; version?: string; message?: string }> {
  try {
    if (!app.isPackaged) return { status: 'not-available', message: '开发模式不检查更新' }
    const result = await autoUpdater.checkForUpdates()
    if (result && result.updateInfo && result.updateInfo.version !== app.getVersion()) {
      updateAvailableVersion = result.updateInfo.version
      return { status: 'available', version: result.updateInfo.version }
    }
    return { status: 'not-available', version: app.getVersion() }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
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
  modelService = new ModelService({ loadSettings, saveSettings })
  agentService = new AgentService({ model: modelService, workspace: workspaceService, resourcesDir: resolveResourcesDir() })
  exportService = new ExportService(workspaceService)
  syncService = new SyncService({ loadSettings, saveSettings, workspacePath: () => workspaceService!.getWorkspacePath() })
  initAutoUpdater()
  createWindow()

  ipcMain.handle('novel:invoke', async (_event, command: string, payload: unknown) => {
    return dispatch(command as CommandName, payload as never)
  })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())

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
