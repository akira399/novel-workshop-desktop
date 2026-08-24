/**
 * @dafuyu/contracts — 桌面版 IPC 契约层。
 *
 * 所有 Renderer → Main 调用必须经过 preload 白名单 + 本层类型。
 * 新增命令先改 CommandMap，再实现 Main 与 Preload。
 */
import type { Book, BookSummary, Chapter } from '@dafuyu/core/novel'
import type { LoreEntry, LoreGroup, PluginError, PromptTemplate } from '@dafuyu/core/types'

export const CONTRACTS_VERSION = '0.1.0'

// ─────────────────────────── 应用/工作区 ───────────────────────────

export interface AppInfo {
  appName: string
  version: string
  contractsVersion: string
  workspacePath: string | null
  electron: string
  node: string
  platform: string
}

export interface WorkspaceInfo {
  path: string
  bookCount: number
  loreEntryCount: number
}

export interface AppSettings {
  workspacePath?: string
  theme?: 'light' | 'dark' | 'system'
  fontSize?: number
  autoSaveMs?: number
  /** 最近打开项目 id */
  lastProjectId?: string
  [key: string]: unknown
}

// ─────────────────────────── 项目/章节/世界书 ───────────────────────────

export interface ChapterListItem {
  no: number
  title: string
  words: number
  updatedAt: string
}

export interface ChapterWithText {
  chapter: Chapter
  content: string
}

/** 章节达标简表（来自 core NovelService.chapterStats）。 */
export interface ChapterStatsBrief {
  words: number
  meetsTarget: boolean
}

export interface LorebookSnapshot {
  entries: LoreEntry[]
  groups: LoreGroup[]
}

export interface ProjectPhaseArtifact {
  phase: string
  content: string | null
}

// ─────────────────────────── 润色/诊断（桌面复用） ───────────────────────────

export interface PolishRequest {
  projectId: string
  chapterNo: number
  text: string
  instruction?: string
}

export interface PolishSuggestionView {
  paraIndex: number
  original: string
  polished: string
  start: number
  end: number
  insertAfter?: boolean
}

export interface PolishResponse {
  suggestions: PolishSuggestionView[]
  tokenEstimate: number
}

export interface DiagnosticRequest {
  projectId: string
  chapterStart: number
  count: number
}

// ─────────────────────────── 模型配置（阶段 2） ───────────────────────────

export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'custom'

export interface ModelProfile {
  id: string
  name: string
  provider: ModelProvider
  baseUrl?: string
  apiKey?: string
  model: string
  temperature?: number
  maxTokens?: number
  /** 按任务覆盖模型名（write/polish/diagnose/revision/chat） */
  taskModels?: Partial<Record<'write' | 'polish' | 'diagnose' | 'revision' | 'chat', string>>
  enabled: boolean
}

// ─────────────────────────── 命令表 ───────────────────────────

export interface CommandMap {
  'app:getInfo': { request: void; response: AppInfo }
  'workspace:get': { request: void; response: WorkspaceInfo | null }
  'workspace:choose': { request: void; response: string | null }
  'workspace:set': { request: { path: string }; response: WorkspaceInfo }
  'projects:list': { request: void; response: BookSummary[] }
  'projects:create': { request: { title: string; genre: string }; response: Book }
  'projects:get': { request: { id: string }; response: Book }
  'projects:delete': { request: { id: string; keepChapters: boolean }; response: { deleted: boolean; keptChapters: boolean } }
  'projects:listArtifacts': { request: { id: string }; response: ProjectPhaseArtifact[] }
  'chapters:list': { request: { projectId: string }; response: ChapterListItem[] }
  'chapters:get': { request: { projectId: string; chapterNo: number }; response: ChapterWithText | null }
  'chapters:save': { request: { projectId: string; chapterNo: number; title: string; text: string; brief?: string }; response: Chapter }
  'chapters:stats': { request: { projectId: string; chapterNo: number }; response: ChapterStatsBrief | null }
  'lorebook:list': { request: { bookId?: string }; response: LorebookSnapshot }
  'lorebook:saveEntry': { request: { entry: LoreEntry }; response: LoreEntry }
  'lorebook:deleteEntry': { request: { id: string }; response: void }
  'lorebook:importJson': { request: { content: string; bookId?: string }; response: { imported: number; warnings: string[] } }
  'prompts:list': { request: void; response: PromptTemplate[] }
  'settings:get': { request: void; response: AppSettings }
  'settings:set': { request: { settings: AppSettings }; response: AppSettings }
}

export type CommandName = keyof CommandMap
export type CommandRequest<K extends CommandName> = CommandMap[K]['request']
export type CommandResponse<K extends CommandName> = CommandMap[K]['response']

/** IPC 统一结果包装（Main 返回，Preload 原样透传）。 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: PluginError }

/** 主进程错误统一转 PluginError。 */
export function toPluginError(error: unknown): PluginError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const candidate = error as { code?: unknown; message?: unknown; details?: unknown }
    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
      return { code: candidate.code as PluginError['code'], message: candidate.message, details: candidate.details }
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { code: 'IO_FAILURE', message, details: error }
}
