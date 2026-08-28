/**
 * @dafuyu/contracts — 桌面版 IPC 契约层。
 *
 * 所有 Renderer → Main 调用必须经过 preload 白名单 + 本层类型。
 * 新增命令先改 CommandMap，再实现 Main 与 Preload。
 */
import type { Book, BookSummary, Chapter } from '@dafuyu/core/novel'
import type { LoreEntry, LoreGroup, PluginError, PromptTemplate, ChapterStats } from '@dafuyu/core/types'
import type { AuditEvent, PhaseId } from '@dafuyu/core/workflow'
import type { ContextPacket } from '@dafuyu/core/context'
import type { Golden3Report } from '@dafuyu/core/diagnose'
import type { ValidationReport } from '@dafuyu/core/validation'
import type { ConsistencyAuditReport } from '@dafuyu/core/consistency'
import type { PolishSuggestion } from '@dafuyu/core/polish'
import type { WizardState } from '@dafuyu/core/guide'
import type { Foreshadow, GlossaryTerm, Idea } from '@dafuyu/core/auxiliary'
import type { ImportResult } from '@dafuyu/core/importer'

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

/** 本地库条目（素材/技能）。 */
export interface LibraryEntry {
  id: string
  kind: 'material' | 'skill'
  title: string
  content: string
  tags: string[]
  /** 绑定到哪些作品 */
  bookIds: string[]
  createdAt: string
  updatedAt: string
}

/** WebDAV 云同步配置（密钥仅存主进程 settings）。 */
export interface SyncConfig {
  url: string
  username: string
  password: string
  remotePath?: string
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

export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'moonshot' | 'ollama' | 'zhipu' | 'custom'

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
  'projects:clone': { request: { sourceId: string; title?: string; genre?: string }; response: Book }
  'projects:phase': { request: { projectId: string; phase?: PhaseId }; response: Book }
  'projects:commit': { request: { projectId: string; phase: PhaseId; artifact: string; errorCount?: number; warningCount?: number; passed?: boolean }; response: Book }
  'projects:override': { request: { projectId: string; phase: PhaseId; action: 'force' | 'reopen' | 'skip' | 'rollback' }; response: Book }
  'projects:audit': { request: { projectId: string }; response: AuditEvent[] }
  'projects:stats': { request: { projectId: string }; response: { id: string; title: string; genre: string; status: Book['status']; currentPhase: PhaseId; stats: Book['stats']; phases: Book['phases'] } }
  'projects:importText': { request: { text: string; title?: string; genre?: string; fileName?: string }; response: ImportResult }
  'projects:importFile': { request: void; response: ImportResult }
  'projects:importDemo': { request: void; response: { bookId: string; imported: number } }
  'chapters:list': { request: { projectId: string }; response: ChapterListItem[] }
  'chapters:get': { request: { projectId: string; chapterNo: number }; response: ChapterWithText | null }
  'chapters:save': { request: { projectId: string; chapterNo: number; title: string; text: string; brief?: string }; response: Chapter }
  'chapters:stats': { request: { projectId: string; chapterNo: number }; response: ChapterStatsBrief | null }
  'chapters:assemble': { request: { projectId: string; chapterNo: number; brief?: string }; response: ContextPacket }
  'chapters:validate': { request: { projectId: string; chapterNo: number; title: string; text: string; brief?: string }; response: ValidationReport }
  'chapters:diagnose': { request: { projectId: string; chapterStart: number; count?: number }; response: Golden3Report }
  'chapters:wordcount': { request: { text: string; min?: number; max?: number; useCjk?: boolean }; response: ChapterStats }
  'chapters:export': { request: { projectId: string; format: 'txt' | 'markdown' | 'platform'; authorNotes?: string; splitVolumes?: boolean }; response: { fileName: string; content: string } }
  'chapters:exportToFile': { request: { projectId: string; format: 'txt' | 'markdown' | 'platform'; authorNotes?: string; splitVolumes?: boolean }; response: { path: string } }
  'export:file': { request: { projectId: string; format: 'epub' | 'pdf' | 'docx'; path?: string }; response: { path: string } }
  'polish:split': { request: { original: string; polished: string }; response: PolishSuggestion[] }
  'polish:apply': { request: { original: string; suggestions: PolishSuggestion[] }; response: string }
  'polish:aiTasteScan': { request: { text: string }; response: import('@dafuyu/core/polish').AiTasteReport }
  'lorebook:list': { request: { bookId?: string }; response: LorebookSnapshot }
  'lorebook:saveEntry': { request: { entry: LoreEntry }; response: LoreEntry }
  'lorebook:deleteEntry': { request: { id: string }; response: void }
  'lorebook:importJson': { request: { content: string; bookId?: string }; response: { imported: number; warnings: string[] } }
  'lorebook:exportSillyTavern': { request: void; response: { content: string; count: number } }
  'lorebook:autogen': { request: { bookId: string; profileId?: string }; response: { imported: number; names: string[] } }
  'lorebook:listGroups': { request: void; response: LoreGroup[] }
  'lorebook:createGroup': { request: { name: string; entry_ids?: string[]; book_ids?: string[]; enabled?: boolean }; response: LoreGroup }
  'lorebook:updateGroup': { request: import('@dafuyu/core/lorebook').UpdateGroupParams; response: LoreGroup }
  'lorebook:deleteGroup': { request: { id: string; deleteEntries?: boolean }; response: { removedGroup: LoreGroup; removedEntries: LoreEntry[] } }
  'lorebook:moveEntry': { request: { entryId: string; targetGroupId?: string }; response: { removedFrom: string[]; targetGroup: LoreGroup | null } }
  'prompts:list': { request: void; response: PromptTemplate[] }
  'extras:foreshadows': { request: { projectId: string }; response: Foreshadow[] }
  'extras:plantForeshadow': { request: { projectId: string; content: string; plantChapter: number; plannedRevealChapter?: number; related?: string }; response: Foreshadow }
  'extras:revealForeshadow': { request: { projectId: string; id: string; chapterNo: number }; response: Foreshadow }
  'extras:dropForeshadow': { request: { projectId: string; id: string }; response: Foreshadow }
  'extras:glossary': { request: { projectId: string }; response: GlossaryTerm[] }
  'extras:addGlossary': { request: { projectId: string; term: string; definition: string; category?: string }; response: GlossaryTerm }
  'extras:extractGlossary': { request: { text: string }; response: string[] }
  'extras:ideas': { request: { projectId: string; query?: string }; response: Idea[] }
  'extras:addIdea': { request: { projectId: string; content: string; tags?: string[] }; response: Idea }
  'extras:ledger': { request: { projectId: string; entity?: string }; response: import('@dafuyu/core/consistency').LedgerEntry[] }
  'extras:timeline': { request: { projectId: string }; response: import('@dafuyu/core/consistency').TimelineEvent[] }
  'extras:recordTimeline': { request: { projectId: string; chapterNo: number; bookTime: string; event: string }; response: import('@dafuyu/core/consistency').TimelineEvent }
  'extras:consistencyAudit': { request: { projectId: string }; response: ConsistencyAuditReport }
  'guide:parseIntent': { request: { text: string }; response: import('@dafuyu/core/guide').IntentAction | null }
  'guide:wizardStatus': { request: { projectId: string }; response: WizardState }
  'guide:wizardAction': { request: { projectId: string; action: 'commit' | 'next' | 'skip'; step?: WizardState['step']; artifact?: string }; response: { wizard: WizardState; nextStep?: WizardState['step'] | null } }
  'library:list': { request: { kind?: 'material' | 'skill'; query?: string }; response: LibraryEntry[] }
  'sync:status': { request: void; response: { configured: boolean; url?: string; remotePath?: string; lastSyncAt?: string } }
  'sync:saveConfig': { request: { config: SyncConfig }; response: void }
  'sync:test': { request: void; response: { ok: boolean; message: string } }
  'sync:push': { request: void; response: { message: string } }
  'sync:pull': { request: void; response: { message: string } }
  'reader:open': { request: void; response: { path: string; ext: string; text: string | null; openedExternal: boolean } }
  'update:check': { request: void; response: { status: 'checking' | 'available' | 'not-available' | 'error'; version?: string; message?: string } }
  'update:download': { request: void; response: { started: boolean; message?: string } }
  'library:save': { request: { entry: LibraryEntry }; response: LibraryEntry }
  'library:delete': { request: { id: string }; response: void }
  'models:list': { request: void; response: ModelProfile[] }
  'models:save': { request: { profile: ModelProfile }; response: ModelProfile }
  'models:delete': { request: { id: string }; response: void }
  'models:test': { request: { id: string }; response: { ok: boolean; message: string; latencyMs: number } }
  'models:fetch': { request: { provider: ModelProvider; baseUrl?: string; apiKey?: string }; response: { models: string[]; error?: string } }
  'agent:complete': { request: { profileId?: string; messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; temperature?: number; maxTokens?: number }; response: { text: string; model: string; provider: string } }
  'agent:writeChapter': { request: { projectId: string; chapterNo: number; brief?: string; profileId?: string }; response: { text: string; model: string } }
  'agent:polish': { request: { projectId: string; chapterNo: number; text?: string; instruction?: string; profileId?: string }; response: { suggestions: PolishSuggestion[]; polished: string; model: string } }
  'agent:depolish': { request: { text: string; profileId?: string }; response: { text: string; model: string } }
  'agent:styleConvert': { request: { projectId: string; chapterNo: number; styleId: string; profileId?: string }; response: { original: string; revised: string; model: string } }
  'agent:revise': { request: { projectId: string; chapterNo: number; mode: 'proofread' | 'rhythm' | 'style'; profileId?: string }; response: { original: string; revised: string; mode: 'proofread' | 'rhythm' | 'style'; wordDelta: number; changeRatio: number; changed: boolean; model: string } }
  'agent:applyAdvice': { request: { text: string; advice: string; profileId?: string }; response: { revised: string; model: string } }
  'agent:marketResearch': { request: { genre: string; topic?: string; profileId?: string }; response: { report: string; model: string } }
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
