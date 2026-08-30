/**
 * 全局状态 — zustand store。
 * 服务端数据（项目/章节/世界书/模型/本地库）经 IPC 拉取后放这里，
 * UI 状态（面板、弹窗、通知）与全部业务动作也集中在此，组件只做渲染。
 */
import { create } from 'zustand'
import type {
  AppInfo, AppSettings, ChapterListItem, LibraryEntry,
  LorebookSnapshot, ModelProfile, WorkspaceInfo,
} from '@dafuyu/contracts'
import type { BookSummary, Chapter } from '@dafuyu/core/novel'
import type { LoreEntry } from '@dafuyu/core/types'
import { applyPolishSuggestions, splitPolishSuggestions } from '@dafuyu/core/polish'
import type { PolishSuggestion } from '@dafuyu/core/polish'
import { call, errorMessage } from './ipc'
import { EXPORT_RICH_FORMATS, EXPORT_TEXT_FORMATS, PROVIDER_PRESETS, REVISION_MODES, STYLE_OPTIONS } from './constants'

// ─────────────────────────── 类型 ───────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface SelectOption {
  value: string
  label: string
  hint?: string
}

export type DialogRequest =
  | { type: 'confirm'; title: string; message: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { type: 'prompt'; title: string; message?: string; defaultValue?: string; placeholder?: string; multiline?: boolean; resolve: (value: string | null) => void }
  | { type: 'select'; title: string; message?: string; options: SelectOption[]; value?: string; resolve: (value: string | null) => void }
  | { type: 'choices'; title: string; message?: string; choices: Array<{ value: string; label: string; danger?: boolean; primary?: boolean }>; resolve: (value: string | null) => void }
  | { type: 'result'; title: string; content: string; resolve: () => void }

export type RightPanel =
  | { kind: 'polish' }
  | { kind: 'diff'; original: string; next: string }
  | { kind: 'result'; title: string; text: string }

export type PanelKey = 'projects' | 'chapters' | 'lorebook' | 'workflow' | 'data' | 'toolbox'

export type EditorBusy = 'write' | 'polish' | 'depolish' | 'style' | 'revise' | 'advice' | null

export interface PolishPreview {
  original: string
  polished: string
  suggestions: PolishSuggestion[]
}

export interface BookBrief {
  id: string
  title: string
  genre: string
  currentPhase: string
  stats: { totalWords: number; chapterCount: number }
}

interface Toast {
  id: number
  kind: 'error' | 'notice'
  text: string
}

// ─────────────────────────── State + Actions ───────────────────────────

interface AppState {
  // app
  info: AppInfo | null
  workspace: WorkspaceInfo | null
  settings: AppSettings
  toasts: Toast[]
  busy: boolean

  // nav
  panel: PanelKey
  chatCollapsed: boolean
  rightPanel: RightPanel | null

  // project / chapter
  projects: BookSummary[]
  projectId: string | null
  book: BookBrief | null
  chapters: ChapterListItem[]
  chapterNo: number | null
  chapterMeta: Chapter | null
  editorTitle: string
  editorText: string
  dirty: boolean
  saving: boolean

  // lorebook / library / prompts
  lorebook: LorebookSnapshot | null
  library: LibraryEntry[]

  // models
  models: ModelProfile[]
  activeModelId: string | null
  testingModelId: string | null
  fetchingModels: boolean
  remoteModels: string[]
  batchProvider: ModelProfile['provider']
  batchBaseUrl: string
  batchApiKey: string
  batchModelNames: string
  selectedRemoteModels: string[]

  // chat
  chatMessages: ChatMessage[]
  chatInput: string
  chatBusy: boolean

  // AI 流式
  streamOpId: string | null
  streamTarget: 'panel' | 'chat' | null
  streamText: string
  activeOpId: string | null

  // AI
  generating: EditorBusy
  polishPreview: PolishPreview | null

  // modals
  dialog: DialogRequest | null
  showModelSettings: boolean
  showAppSettings: boolean
  loreEditor: { mode: 'new' | 'edit'; entry?: LoreEntry } | null
  reader: { path: string; ext: string; text: string | null } | null
  fontSize: number

  // ── actions ──
  boot(): Promise<void>
  run(action: () => Promise<void>, successNotice?: string): Promise<void>
  notify(text: string): void
  fail(text: string): void
  dismissToast(id: number): void

  askConfirm(title: string, message: string, opts?: { confirmLabel?: string; danger?: boolean }): Promise<boolean>
  askPrompt(title: string, defaultValue?: string, opts?: { placeholder?: string; multiline?: boolean; message?: string }): Promise<string | null>
  askSelect(title: string, options: SelectOption[], value?: string, message?: string): Promise<string | null>
  askChoices(title: string, message: string, choices: Array<{ value: string; label: string; danger?: boolean; primary?: boolean }>): Promise<string | null>
  showResult(title: string, content: string): Promise<void>

  setPanel(panel: PanelKey): void
  toggleChatCollapsed(): void
  openRightPanel(panel: RightPanel): void
  closeRightPanel(): void

  refreshWorkspace(): Promise<void>
  chooseWorkspace(): Promise<void>

  openProject(id: string): Promise<void>
  createProject(): Promise<void>
  importFile(): Promise<void>
  importDemo(): Promise<void>
  deleteBook(): Promise<void>

  guardDirty(): Promise<boolean>
  loadChapter(no: number): Promise<void>
  newChapter(): void
  renameChapter(no: number): Promise<void>
  deleteChapter(no: number): Promise<void>
  setEditorTitle(title: string): void
  setEditorText(text: string, opts?: { fromEditor?: boolean }): void
  saveChapter(explicit?: boolean): Promise<void>
  scheduleAutoSave(): void

  writeChapterAI(): Promise<void>
  polishAI(): Promise<void>
  togglePolish(id: string): void
  acceptAllPolish(): void
  rejectAllPolish(): void
  discardPolish(): void
  savePolish(): Promise<void>
  applyDiff(): void
  depolishAI(): Promise<void>
  styleConvertAI(): Promise<void>
  reviseAI(): Promise<void>
  applyAdviceAI(): Promise<void>
  validateAI(): Promise<void>
  diagnoseAI(): Promise<void>
  wordcountAI(): Promise<void>
  exportText(): Promise<void>
  exportRich(): Promise<void>
  marketResearch(): Promise<void>
  auditLog(): Promise<void>
  cloneProject(): Promise<void>
  showPrompts(): Promise<void>

  loadLorebook(bookId?: string): Promise<void>
  openLoreEditor(mode: 'new' | 'edit', entry?: LoreEntry): void
  closeLoreEditor(): void
  saveLoreEntry(entry: LoreEntry): Promise<void>
  deleteLoreEntry(id: string): Promise<void>
  createLoreGroup(): Promise<void>
  renameLoreGroup(id: string, name: string): Promise<void>
  toggleLoreGroup(id: string, enabled: boolean): Promise<void>
  deleteLoreGroup(id: string): Promise<void>
  autogenLorebook(): Promise<void>
  exportSillyTavern(): Promise<void>
  importLoreJson(): Promise<void>

  saveLibraryEntry(entry: LibraryEntry): Promise<void>
  deleteLibraryEntry(id: string): Promise<void>

  loadModels(): Promise<void>
  openModelSettings(): void
  closeModelSettings(): void
  setActiveModel(id: string): void
  saveModel(profile: ModelProfile): Promise<void>
  deleteModel(id: string): Promise<void>
  testModel(id: string): Promise<void>
  fetchRemoteModels(): Promise<void>
  setBatch(partial: Partial<Pick<AppState, 'batchProvider' | 'batchBaseUrl' | 'batchApiKey' | 'batchModelNames' | 'selectedRemoteModels'>>): void
  saveBatchModels(): Promise<void>

  openAppSettings(): void
  closeAppSettings(): void
  setTheme(theme: NonNullable<AppSettings['theme']>): void

  setChatInput(text: string): void
  clearChat(): void
  sendChat(): Promise<void>
  applyStreamChunk(opId: string, delta: string): void
  cancelActiveOp(): Promise<void>

  openReader(): Promise<void>
  closeReader(): void
  setFontSize(size: number): Promise<void>
}

let toastSeq = 0
let booted = false
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

function newOpId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 书籍题材 → 写章题材模板（resources/prompts/writing-chapter-*）。 */
const GENRE_TEMPLATE_MAP: Record<string, string> = {
  fantasy: 'writing-chapter-xuanhuan',
  xianxia: 'writing-chapter-xianxia',
  game: 'writing-chapter-game',
  history: 'writing-chapter-historical',
  humor: 'writing-chapter-humor',
  scifi: 'writing-chapter-scifi',
  mystery: 'writing-chapter-suspense',
  suspense: 'writing-chapter-suspense',
  horror: 'writing-chapter-suspense',
  urban: 'writing-chapter-urban',
  business: 'writing-chapter-urban',
  campus: 'writing-chapter-urban',
  realistic: 'writing-chapter-urban',
}

export const useStore = create<AppState>()((set, get) => ({
  info: null,
  workspace: null,
  settings: {},
  toasts: [],
  busy: false,

  panel: 'projects',
  chatCollapsed: false,
  rightPanel: null,

  projects: [],
  projectId: null,
  book: null,
  chapters: [],
  chapterNo: null,
  chapterMeta: null,
  editorTitle: '',
  editorText: '',
  dirty: false,
  saving: false,

  lorebook: null,
  library: [],

  models: [],
  activeModelId: null,
  testingModelId: null,
  fetchingModels: false,
  remoteModels: [],
  batchProvider: 'deepseek',
  batchBaseUrl: 'https://api.deepseek.com',
  batchApiKey: '',
  batchModelNames: '',
  selectedRemoteModels: [],

  chatMessages: [],
  chatInput: '',
  chatBusy: false,

  streamOpId: null,
  streamTarget: null,
  streamText: '',
  activeOpId: null,

  generating: null,
  polishPreview: null,

  dialog: null,
  showModelSettings: false,
  showAppSettings: false,
  loreEditor: null,
  reader: null,
  fontSize: 16,

  // ── 基础 ──

  async boot() {
    if (booted) return
    booted = true
    await get().run(async () => {
      const [info, workspace, settings, projects, library, models] = await Promise.all([
        call('app:getInfo', undefined),
        call('workspace:get', undefined),
        call('settings:get', undefined),
        call('projects:list', undefined),
        call('library:list', {}),
        call('models:list', undefined),
      ])
      set({
        info, workspace, settings, projects, library, models,
        activeModelId: models[0]?.id ?? null,
        fontSize: typeof settings.fontSize === 'number' ? settings.fontSize : 16,
      })
      const last = settings.lastProjectId
      if (typeof last === 'string' && projects.some((p) => p.id === last)) {
        await get().openProject(last)
      }
    })
  },

  async run(action, successNotice) {
    set({ busy: true })
    try {
      await action()
      if (successNotice) get().notify(successNotice)
    } catch (error) {
      get().fail(errorMessage(error))
    } finally {
      set({ busy: false })
    }
  },

  notify(text) {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, kind: 'notice', text }] }))
    setTimeout(() => get().dismissToast(id), 3200)
  },

  fail(text) {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, kind: 'error', text }] }))
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  askConfirm(title, message, opts) {
    return new Promise((resolve) => set({
      dialog: { type: 'confirm', title, message, confirmLabel: opts?.confirmLabel, danger: opts?.danger, resolve },
    }))
  },

  askPrompt(title, defaultValue = '', opts) {
    return new Promise((resolve) => set({
      dialog: { type: 'prompt', title, defaultValue, placeholder: opts?.placeholder, multiline: opts?.multiline, message: opts?.message, resolve },
    }))
  },

  askSelect(title, options, value, message) {
    return new Promise((resolve) => set({ dialog: { type: 'select', title, options, value, message, resolve } }))
  },

  askChoices(title, message, choices) {
    return new Promise((resolve) => set({ dialog: { type: 'choices', title, message, choices, resolve } }))
  },

  showResult(title, content) {
    return new Promise((resolve) => set({ dialog: { type: 'result', title, content, resolve } }))
  },

  setPanel(panel) { set({ panel }) },
  toggleChatCollapsed() { set((s) => ({ chatCollapsed: !s.chatCollapsed })) },
  openRightPanel(panel) { set({ rightPanel: panel }) },
  closeRightPanel() { set({ rightPanel: null }) },

  async refreshWorkspace() {
    const [info, workspace, projects] = await Promise.all([
      call('app:getInfo', undefined),
      call('workspace:get', undefined),
      call('projects:list', undefined),
    ])
    set({ info, workspace, projects })
  },

  async chooseWorkspace() {
    await get().run(async () => {
      const path = await call('workspace:choose', undefined)
      if (path) {
        await get().refreshWorkspace()
        get().notify(`工作区：${path}`)
      }
    })
  },

  // ── 项目 ──

  async openProject(id) {
    await get().run(async () => {
      if (!(await get().guardDirty())) return
      const [book, chapters, lorebook] = await Promise.all([
        call('projects:get', { id }),
        call('chapters:list', { projectId: id }),
        call('lorebook:list', { bookId: id }),
      ])
      set((s) => ({
        projectId: id,
        book: { id: book.id, title: book.title, genre: book.genre, currentPhase: book.currentPhase, stats: book.stats },
        chapters, lorebook,
        chapterNo: null, chapterMeta: null, editorText: '', editorTitle: '',
        dirty: false,
        panel: 'chapters',
        settings: { ...s.settings, lastProjectId: id },
      }))
      await call('settings:set', { settings: { lastProjectId: id } }).catch(() => undefined)
    })
  },

  async createProject() {
    const title = await get().askPrompt('新作品标题', '', { placeholder: '如：青云问道' })
    if (!title) return
    const genre = await get().askSelect('选择题材', [
      { value: 'fantasy', label: '玄幻' },
      { value: 'xianxia', label: '仙侠' },
      { value: 'urban', label: '都市' },
      { value: 'scifi', label: '科幻' },
      { value: 'history', label: '历史' },
      { value: 'game', label: '游戏' },
      { value: 'suspense', label: '悬疑' },
      { value: 'humor', label: '幽默' },
    ], 'fantasy')
    if (!genre) return
    await get().run(async () => {
      const book = await call('projects:create', { title, genre })
      await get().refreshWorkspace()
      await get().openProject(book.id)
    }, '作品已创建')
  },

  async importFile() {
    await get().run(async () => {
      const result = await call('projects:importFile', undefined)
      if (!result) return
      get().notify(`已导入《${result.title}》：${result.chapterCount} 章 / ${result.totalWords} 字`)
      await get().refreshWorkspace()
      await get().openProject(result.bookId)
    })
  },

  async importDemo() {
    await get().run(async () => {
      const r = await call('projects:importDemo', undefined)
      get().notify(`示例《青云问道》已导入（${r.imported} 条世界书）`)
      await get().refreshWorkspace()
      await get().openProject(r.bookId)
    })
  },

  async deleteBook() {
    const { projectId, book } = get()
    if (!projectId || !book) return
    const ok = await get().askConfirm('删除作品', `确定删除《${book.title}》吗？正文文件将一并删除，此操作不可恢复。`, { confirmLabel: '删除', danger: true })
    if (!ok) return
    await get().run(async () => {
      await call('projects:delete', { id: projectId, keepChapters: false })
      set({ projectId: null, book: null, chapters: [], chapterNo: null, chapterMeta: null, editorText: '', editorTitle: '', dirty: false, panel: 'projects' })
      await get().refreshWorkspace()
    }, '已删除')
  },

  // ── 章节 ──

  /** 有未保存修改时询问处理方式；返回 true 表示可以继续切换。 */
  async guardDirty() {
    if (!get().dirty) return true
    const choice = await get().askChoices('未保存的修改', '当前章节有未保存的修改，要如何处理？', [
      { value: 'save', label: '保存并继续', primary: true },
      { value: 'discard', label: '放弃修改', danger: true },
      { value: 'cancel', label: '取消' },
    ])
    if (choice === 'save') {
      await get().saveChapter()
      return !get().dirty
    }
    if (choice === 'discard') {
      set({ dirty: false })
      return true
    }
    return false
  },

  async loadChapter(no) {
    if (!get().projectId) return
    if (!(await get().guardDirty())) return
    await get().run(async () => {
      const chapter = await call('chapters:get', { projectId: get().projectId!, chapterNo: no })
      if (chapter) {
        set({
          chapterNo: no, chapterMeta: chapter.chapter,
          editorText: chapter.content, editorTitle: chapter.chapter.title,
          dirty: false,
        })
      } else {
        // 未落盘的新章节（如刚点过"新建章节"）：直接进入编辑态
        set({
          chapterNo: no, chapterMeta: null,
          editorText: '', editorTitle: `第 ${no} 章`,
          dirty: false,
        })
      }
    })
  },

  newChapter() {
    const { chapters } = get()
    const next = chapters.length > 0 ? Math.max(...chapters.map((c) => c.no)) + 1 : 1
    set({
      chapterNo: next, chapterMeta: null,
      editorText: '', editorTitle: `第 ${next} 章`,
      dirty: true,
    })
  },

  async renameChapter(no) {
    const target = get().chapters.find((c) => c.no === no)
    const title = await get().askPrompt('重命名章节', target?.title ?? `第 ${no} 章`)
    if (!title || !title.trim()) return
    await get().run(async () => {
      if (no === get().chapterNo) {
        set({ editorTitle: title.trim(), dirty: true })
        await get().saveChapter()
        return
      }
      const chapter = await call('chapters:get', { projectId: get().projectId!, chapterNo: no })
      if (!chapter) return
      await call('chapters:save', { projectId: get().projectId!, chapterNo: no, title: title.trim(), text: chapter.content })
      set({ chapters: await call('chapters:list', { projectId: get().projectId! }) })
    }, '已重命名')
  },

  async deleteChapter(no) {
    const item = get().chapters.find((c) => c.no === no)
    const ok = await get().askConfirm('删除章节', `确定删除「${item?.title ?? `第 ${no} 章`}」吗？正文将一并删除。`, { confirmLabel: '删除', danger: true })
    if (!ok) return
    await get().run(async () => {
      const { projectId, chapterNo } = get()
      if (!projectId) return
      await call('chapters:delete', { projectId, chapterNo: no })
      const chapters = await call('chapters:list', { projectId })
      set({ chapters })
      if (chapterNo === no) {
        const prev = chapters[chapters.length - 1]
        if (prev) await get().loadChapter(prev.no)
        else set({ chapterNo: null, chapterMeta: null, editorText: '', editorTitle: '', dirty: false })
      }
    }, '章节已删除')
  },

  setEditorTitle(title) {
    set({ editorTitle: title, dirty: true })
    get().scheduleAutoSave()
  },

  /** 编辑器内容变化。fromEditor=true 表示来自 CM 输入（不再回写编辑器）。 */
  setEditorText(text, opts) {
    set({ editorText: text, dirty: true })
    if (opts?.fromEditor !== true) get().scheduleAutoSave()
  },

  /** 防抖自动保存（间隔可配置，默认 1.5s；AI 生成中不触发）。 */
  scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    const raw = get().settings.autoSaveMs
    const ms = typeof raw === 'number' && raw > 0 ? raw : 1500
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null
      const s = get()
      if (s.dirty && s.projectId && s.chapterNo != null && !s.generating && !s.saving) {
        void s.saveChapter(false)
      }
    }, ms)
  },

  async saveChapter(explicit = false) {
    const { projectId, chapterNo, editorTitle, editorText } = get()
    if (!projectId || chapterNo == null) return
    if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null }
    set({ saving: true })
    try {
      const saved = await call('chapters:save', {
        projectId, chapterNo,
        title: editorTitle.trim() || `第 ${chapterNo} 章`,
        text: editorText,
      })
      const chapters = await call('chapters:list', { projectId })
      set((s) => ({
        chapterMeta: s.chapterNo === chapterNo ? saved : s.chapterMeta,
        chapters, dirty: false,
      }))
      if (explicit) get().notify('章节已保存')
    } catch (error) {
      get().fail(errorMessage(error))
    } finally {
      set({ saving: false })
    }
  },

  // ── AI 创作动作 ──

  async writeChapterAI() {
    const { projectId, chapterNo, book } = get()
    if (!projectId) return
    const no = chapterNo ?? 1
    const opId = newOpId()
    set({
      generating: 'write', chapterNo: no,
      streamOpId: opId, streamTarget: 'panel', streamText: '', activeOpId: opId,
      rightPanel: { kind: 'result', title: `AI 正在写第 ${no} 章…`, text: '' },
    })
    await get().run(async () => {
      try {
        const result = await call('agent:writeChapter', {
          projectId, chapterNo: no,
          profileId: get().activeModelId ?? undefined,
          templateId: book ? GENRE_TEMPLATE_MAP[book.genre] : undefined,
          stream: true, opId,
        })
        if (result.aborted) {
          const partial = get().streamText || result.text
          set({ rightPanel: { kind: 'result', title: '已停止生成（保留部分内容）', text: partial } })
          get().notify('已停止生成，部分内容保留在右侧')
        } else {
          get().setEditorText(result.text)
          set((s) => ({ editorTitle: s.editorTitle || `第 ${no} 章`, dirty: true, rightPanel: null }))
          get().notify('AI 已生成章节，请检查后保存')
        }
      } catch (error) {
        set({ rightPanel: null })
        get().fail(`AI 写章失败：${errorMessage(error)}`)
      } finally {
        set({ generating: null, streamOpId: null, streamTarget: null, streamText: '', activeOpId: null })
      }
    })
  },

  async polishAI() {
    const { projectId, chapterNo, editorText } = get()
    if (!projectId || !chapterNo) {
      get().fail('请先选择或打开一个章节后再润色')
      return
    }
    if (!editorText.trim()) {
      get().fail('当前章节没有可润色的正文')
      return
    }
    const opId = newOpId()
    set({
      generating: 'polish',
      streamOpId: opId, streamTarget: 'panel', streamText: '', activeOpId: opId,
      rightPanel: { kind: 'result', title: 'AI 正在润色…', text: '' },
    })
    await get().run(async () => {
      try {
        const result = await call('agent:polish', { projectId, chapterNo, text: editorText, profileId: get().activeModelId ?? undefined, stream: true, opId })
        if (result.aborted) {
          set({ rightPanel: { kind: 'result', title: '已停止（润色未完成）', text: get().streamText || result.polished } })
        } else {
          const suggestions = splitPolishSuggestions(editorText, result.polished)
          get().setEditorText(result.polished)
          set({ polishPreview: { original: editorText, polished: result.polished, suggestions }, rightPanel: { kind: 'polish' } })
          get().notify('润色完成，可在右侧逐条采纳')
        }
      } catch (error) {
        set({ rightPanel: null })
        get().fail(`一键润色失败：${errorMessage(error)}`)
      } finally {
        set({ generating: null, streamOpId: null, streamTarget: null, streamText: '', activeOpId: null })
      }
    })
  },

  togglePolish(id) {
    set((s) => {
      if (!s.polishPreview) return s
      return {
        polishPreview: {
          ...s.polishPreview,
          suggestions: s.polishPreview.suggestions.map((item) => (item.id === id ? { ...item, accepted: !item.accepted } : item)),
        },
      }
    })
  },

  acceptAllPolish() {
    set((s) => {
      if (!s.polishPreview) return s
      return {
        polishPreview: {
          ...s.polishPreview,
          suggestions: s.polishPreview.suggestions.map((item) => (item.polished.length > 0 ? { ...item, accepted: true } : item)),
        },
      }
    })
  },

  rejectAllPolish() {
    set((s) => {
      if (!s.polishPreview) return s
      return { polishPreview: { ...s.polishPreview, suggestions: s.polishPreview.suggestions.map((item) => ({ ...item, accepted: false })), editorText: s.polishPreview.original } }
    })
  },

  discardPolish() {
    set((s) => {
      if (!s.polishPreview) return s
      return { polishPreview: null, editorText: s.polishPreview.original, dirty: true, rightPanel: null }
    })
  },

  async savePolish() {
    const { projectId, chapterNo, editorTitle, polishPreview } = get()
    if (!projectId || !chapterNo || !polishPreview) return
    const preview = polishPreview
    await get().run(async () => {
      const text = applyPolishSuggestions(preview.original, preview.suggestions)
      const saved = await call('chapters:save', { projectId, chapterNo, title: editorTitle, text })
      const chapters = await call('chapters:list', { projectId })
      set({ chapterMeta: saved, chapters, polishPreview: null, rightPanel: null, editorText: text, dirty: false })
    }, '润色结果已保存（仅采纳的改动）')
  },

  /** 应用聊天 AI 的写回 diff（整篇替换编辑器，保留撤销）。 */
  applyDiff() {
    const panel = get().rightPanel
    if (!panel || panel.kind !== 'diff') return
    get().setEditorText(panel.next)
    set({ rightPanel: null })
    get().notify('已应用 AI 修改，可撤销')
  },

  async depolishAI() {
    const { editorText } = get()
    if (!editorText.trim()) {
      get().fail('当前没有可处理的正文')
      return
    }
    const opId = newOpId()
    set({ generating: 'depolish', streamOpId: opId, streamTarget: 'panel', streamText: '', activeOpId: opId, rightPanel: { kind: 'result', title: 'AI 正在去 AI 味…', text: '' } })
    await get().run(async () => {
      try {
        const result = await call('agent:depolish', { text: editorText, profileId: get().activeModelId ?? undefined, stream: true, opId })
        if (result.aborted) {
          set({ rightPanel: { kind: 'result', title: '已停止（保留部分内容）', text: get().streamText || result.text } })
        } else {
          get().setEditorText(result.text)
          set({ rightPanel: null })
          get().notify('去 AI 味完成')
        }
      } finally {
        set({ generating: null, streamOpId: null, streamTarget: null, streamText: '', activeOpId: null })
      }
    })
  },

  async styleConvertAI() {
    const { projectId, chapterNo } = get()
    if (!projectId || !chapterNo) {
      get().fail('请先选择章节')
      return
    }
    const styleId = await get().askSelect('选择文风', [{ value: '__skip__', label: '（取消）' }, ...STYLE_OPTIONS])
    if (!styleId || styleId === '__skip__') return
    const opId = newOpId()
    set({ generating: 'style', streamOpId: opId, streamTarget: 'panel', streamText: '', activeOpId: opId, rightPanel: { kind: 'result', title: 'AI 正在转换文风…', text: '' } })
    await get().run(async () => {
      try {
        const result = await call('agent:styleConvert', { projectId, chapterNo, styleId, profileId: get().activeModelId ?? undefined, stream: true, opId })
        if (result.aborted) {
          set({ rightPanel: { kind: 'result', title: '已停止（保留部分内容）', text: get().streamText || result.revised } })
        } else {
          get().setEditorText(result.revised)
          set({ rightPanel: null })
          get().notify('文风转换完成')
        }
      } finally {
        set({ generating: null, streamOpId: null, streamTarget: null, streamText: '', activeOpId: null })
      }
    })
  },

  async reviseAI() {
    const { projectId, chapterNo } = get()
    if (!projectId || !chapterNo) {
      get().fail('请先选择章节')
      return
    }
    const mode = await get().askSelect('选择修订方式', REVISION_MODES.map((m) => ({ value: m.value, label: m.label })))
    if (!mode) return
    const opId = newOpId()
    set({ generating: 'revise', streamOpId: opId, streamTarget: 'panel', streamText: '', activeOpId: opId, rightPanel: { kind: 'result', title: 'AI 正在修订…', text: '' } })
    await get().run(async () => {
      try {
        const r = await call('agent:revise', { projectId, chapterNo, mode: mode as 'proofread' | 'rhythm' | 'style', profileId: get().activeModelId ?? undefined, stream: true, opId })
        if (r.aborted) {
          set({ rightPanel: { kind: 'result', title: '已停止（保留部分内容）', text: get().streamText || r.revised } })
        } else {
          get().setEditorText(r.revised)
          set({ rightPanel: null })
          get().notify(`修订完成：${r.wordDelta >= 0 ? '+' : ''}${r.wordDelta} 字，改动 ${Math.round(r.changeRatio * 100)}%`)
        }
      } finally {
        set({ generating: null, streamOpId: null, streamTarget: null, streamText: '', activeOpId: null })
      }
    })
  },

  async applyAdviceAI() {
    const { editorText } = get()
    const advice = await get().askPrompt('输入诊断建议', '', { placeholder: '如：加强主角动机，第二段节奏拖沓', multiline: true })
    if (!advice) return
    const opId = newOpId()
    set({ generating: 'advice', streamOpId: opId, streamTarget: 'panel', streamText: '', activeOpId: opId, rightPanel: { kind: 'result', title: 'AI 正在应用建议…', text: '' } })
    await get().run(async () => {
      try {
        const r = await call('agent:applyAdvice', { text: editorText, advice, profileId: get().activeModelId ?? undefined, stream: true, opId })
        if (r.aborted) {
          set({ rightPanel: { kind: 'result', title: '已停止（保留部分内容）', text: get().streamText || r.revised } })
        } else {
          get().setEditorText(r.revised)
          set({ rightPanel: null })
          get().notify('建议已应用')
        }
      } finally {
        set({ generating: null, streamOpId: null, streamTarget: null, streamText: '', activeOpId: null })
      }
    })
  },

  async validateAI() {
    const { projectId, chapterNo, editorTitle, editorText } = get()
    if (!projectId || !chapterNo) {
      get().fail('请先选择章节')
      return
    }
    await get().run(async () => {
      const report = await call('chapters:validate', { projectId, chapterNo, title: editorTitle, text: editorText })
      const text = report.issues.length > 0
        ? report.issues.map((i) => `[${i.level === 'error' ? '错误' : i.level === 'warning' ? '警告' : '提示'}] ${i.message}`).join('\n')
        : '校验通过，无问题'
      get().openRightPanel({ kind: 'result', title: `章节校验：${report.passed ? '通过' : '未通过'}`, text })
    })
  },

  async diagnoseAI() {
    const { projectId, chapterNo } = get()
    if (!projectId) return
    await get().run(async () => {
      const report = await call('chapters:diagnose', { projectId, chapterStart: chapterNo ?? 1, count: 3 })
      const text = report.issues.length > 0
        ? report.issues.map((i) => `[${i.severity}] ${i.advice}`).join('\n')
        : '未发现明显问题'
      get().openRightPanel({ kind: 'result', title: `黄金三章诊断：${report.score}/100`, text })
    })
  },

  async wordcountAI() {
    await get().run(async () => {
      const stats = await call('chapters:wordcount', { text: get().editorText })
      await get().showResult('字数统计', `总字符 ${stats.totalChars}\n中文字符 ${stats.cjkChars}\n段落 ${stats.paragraphs}\n对话占比 ${Math.round(stats.dialogueRatio * 100)}%`)
    })
  },

  async exportText() {
    const { projectId } = get()
    if (!projectId) return
    const format = await get().askSelect('选择导出格式', EXPORT_TEXT_FORMATS.map((f) => ({ value: f.value, label: f.label })), 'markdown')
    if (!format) return
    await get().run(async () => {
      const result = await call('chapters:exportToFile', { projectId, format: format as 'txt' | 'markdown' | 'platform' })
      if (result.path) get().notify(`已导出：${result.path}`)
    })
  },

  async exportRich() {
    const { projectId } = get()
    if (!projectId) return
    const format = await get().askSelect('选择电子书格式', EXPORT_RICH_FORMATS.map((f) => ({ value: f.value, label: f.label })), 'epub')
    if (!format) return
    await get().run(async () => {
      const result = await call('export:file', { projectId, format: format as 'epub' | 'pdf' | 'docx' })
      if (result.path) get().notify(`已导出：${result.path}`)
    })
  },

  async marketResearch() {
    const options = [
      { value: '玄幻', label: '玄幻' },
      { value: '仙侠', label: '仙侠' },
      { value: '都市', label: '都市' },
      { value: '科幻', label: '科幻' },
      { value: '历史', label: '历史' },
      { value: '游戏', label: '游戏' },
      { value: '悬疑', label: '悬疑' },
    ]
    const genre = await get().askSelect('市场调研 · 选择题材', options)
    if (!genre) return
    const topic = await get().askPrompt('选题方向（可留空）', '', { placeholder: '如：规则怪谈 + 无限流' })
    const opId = newOpId()
    set({ streamOpId: opId, streamTarget: 'panel', streamText: '', activeOpId: opId, rightPanel: { kind: 'result', title: '市场调研生成中…', text: '' } })
    await get().run(async () => {
      try {
        const result = await call('agent:marketResearch', { genre, topic: topic ?? undefined, profileId: get().activeModelId ?? undefined, stream: true, opId })
        set({ rightPanel: { kind: 'result', title: result.aborted ? '市场调研（已停止）' : `市场调研：${genre}`, text: result.aborted ? (get().streamText || result.report) : result.report } })
      } catch (error) {
        set({ rightPanel: null })
        throw error
      } finally {
        set({ streamOpId: null, streamTarget: null, streamText: '', activeOpId: null })
      }
    })
  },

  async auditLog() {
    const { projectId } = get()
    if (!projectId) return
    await get().run(async () => {
      const audit = await call('projects:audit', { projectId })
      const text = audit.length > 0
        ? audit.slice(-100).reverse().map((a) => `${a.at.slice(0, 16).replace('T', ' ')}  ${a.action}  ${a.phase}  ${a.detail}`).join('\n')
        : '暂无审计记录'
      await get().showResult('项目审计日志', text)
    })
  },

  async cloneProject() {
    const { projects } = get()
    if (projects.length === 0) {
      get().fail('当前没有可克隆的作品')
      return
    }
    const sourceId = await get().askSelect('选择要克隆的作品', projects.map((p) => ({ value: p.id, label: p.title })))
    if (!sourceId) return
    await get().run(async () => {
      const book = await call('projects:clone', { sourceId })
      await get().refreshWorkspace()
      get().notify(`已克隆为《${book.title}》`)
    })
  },

  async showPrompts() {
    await get().run(async () => {
      const lib = await call('prompts:list', undefined)
      const text = lib.length > 0
        ? lib.map((p) => `${p.id}  ${p.name}${p.description ? ` — ${p.description}` : ''}`).join('\n')
        : '提示词库为空'
      await get().showResult('提示词库', text)
    })
  },

  // ── 世界书 ──

  async loadLorebook(bookId) {
    const lorebook = await call('lorebook:list', { bookId: bookId ?? get().projectId ?? undefined })
    set({ lorebook })
  },

  openLoreEditor(mode, entry) {
    set({ loreEditor: { mode, entry } })
  },

  closeLoreEditor() {
    set({ loreEditor: null })
  },

  async saveLoreEntry(entry) {
    await get().run(async () => {
      await call('lorebook:saveEntry', { entry })
      await get().loadLorebook(get().projectId ?? undefined)
    }, '条目已保存')
  },

  async deleteLoreEntry(id) {
    const ok = await get().askConfirm('删除条目', '确定删除该世界书条目吗？', { confirmLabel: '删除', danger: true })
    if (!ok) return
    await get().run(async () => {
      await call('lorebook:deleteEntry', { id })
      await get().loadLorebook(get().projectId ?? undefined)
    }, '条目已删除')
  },

  async createLoreGroup() {
    const name = await get().askPrompt('新分组名称', '', { placeholder: '如：人物设定' })
    if (!name) return
    await get().run(async () => {
      await call('lorebook:createGroup', { name })
      await get().loadLorebook(get().projectId ?? undefined)
    }, '分组已创建')
  },

  async renameLoreGroup(id, name) {
    const next = await get().askPrompt('重命名分组', name)
    if (!next) return
    await get().run(async () => {
      await call('lorebook:updateGroup', { id, name: next })
      await get().loadLorebook(get().projectId ?? undefined)
    })
  },

  async toggleLoreGroup(id, enabled) {
    await get().run(async () => {
      await call('lorebook:updateGroup', { id, enabled })
      await get().loadLorebook(get().projectId ?? undefined)
    })
  },

  async deleteLoreGroup(id) {
    const ok = await get().askConfirm('删除分组', '确定删除该分组吗？（组内条目保留）', { confirmLabel: '删除', danger: true })
    if (!ok) return
    await get().run(async () => {
      await call('lorebook:deleteGroup', { id })
      await get().loadLorebook(get().projectId ?? undefined)
    }, '分组已删除')
  },

  async autogenLorebook() {
    const { projectId } = get()
    if (!projectId) {
      get().fail('请先选择作品')
      return
    }
    await get().run(async () => {
      const result = await call('lorebook:autogen', { bookId: projectId, profileId: get().activeModelId ?? undefined })
      await get().loadLorebook(projectId)
      get().notify(`AI 已生成 ${result.imported} 条：${result.names.slice(0, 5).join('、')}${result.names.length > 5 ? ' 等' : ''}`)
    })
  },

  async exportSillyTavern() {
    await get().run(async () => {
      const result = await call('lorebook:exportSillyTavern', undefined)
      await get().showResult(`导出到酒馆（${result.count} 条）`, result.content)
    })
  },

  async importLoreJson() {
    const content = await get().askPrompt('粘贴世界书 JSON', '', { multiline: true, message: '支持 Operit / SillyTavern / 角色卡格式' })
    if (!content) return
    await get().run(async () => {
      const r = await call('lorebook:importJson', { content, bookId: get().projectId ?? undefined })
      await get().loadLorebook(get().projectId ?? undefined)
      get().notify(`导入 ${r.imported} 条世界书条目`)
    })
  },

  // ── 本地库 ──

  async saveLibraryEntry(entry) {
    await get().run(async () => {
      await call('library:save', { entry })
      set({ library: await call('library:list', {}) })
    }, '已保存')
  },

  async deleteLibraryEntry(id) {
    const ok = await get().askConfirm('删除条目', '确定删除该素材/技能吗？', { confirmLabel: '删除', danger: true })
    if (!ok) return
    await get().run(async () => {
      await call('library:delete', { id })
      set({ library: await call('library:list', {}) })
    }, '已删除')
  },

  // ── 模型 ──

  async loadModels() {
    const models = await call('models:list', undefined)
    set((s) => ({
      models,
      activeModelId: s.activeModelId && models.some((m) => m.id === s.activeModelId) ? s.activeModelId : models[0]?.id ?? null,
    }))
  },

  openModelSettings() {
    set({ showModelSettings: true })
    void get().loadModels()
  },

  closeModelSettings() {
    set({ showModelSettings: false })
  },

  setActiveModel(id) {
    set({ activeModelId: id })
  },

  async saveModel(profile) {
    await get().run(async () => {
      const saved = await call('models:save', { profile })
      const models = await call('models:list', undefined)
      set((s) => ({ models, activeModelId: s.activeModelId ?? saved.id }))
      get().notify(`模型「${saved.name}」已保存`)
    })
  },

  async deleteModel(id) {
    const target = get().models.find((m) => m.id === id)
    const ok = await get().askConfirm('删除模型', `确定删除模型「${target?.name ?? id}」吗？`, { confirmLabel: '删除', danger: true })
    if (!ok) return
    await get().run(async () => {
      await call('models:delete', { id })
      const models = await call('models:list', undefined)
      set((s) => ({ models, activeModelId: s.activeModelId === id ? models[0]?.id ?? null : s.activeModelId }))
    })
  },

  async testModel(id) {
    set({ testingModelId: id })
    await get().run(async () => {
      try {
        const result = await call('models:test', { id })
        if (result.ok) get().notify(`${result.message}（${result.latencyMs}ms）`)
        else get().fail(result.message)
      } finally {
        set({ testingModelId: null })
      }
    })
  },

  async fetchRemoteModels() {
    const { batchProvider, batchBaseUrl, batchApiKey } = get()
    if (!batchProvider) return
    set({ fetchingModels: true, remoteModels: [], selectedRemoteModels: [] })
    await get().run(async () => {
      try {
        const result = await call('models:fetch', { provider: batchProvider, baseUrl: batchBaseUrl, apiKey: batchApiKey })
        set({ remoteModels: result.models, fetchingModels: false })
        if (result.error) get().fail(`获取模型列表失败：${result.error}`)
        else get().notify(`获取到 ${result.models.length} 个模型，请勾选要添加的`)
      } catch (error) {
        set({ fetchingModels: false })
        throw error
      }
    })
  },

  setBatch(partial) {
    set(partial)
  },

  async saveBatchModels() {
    const { batchProvider, batchBaseUrl, batchApiKey, batchModelNames, selectedRemoteModels } = get()
    const manual = batchModelNames.split(/[\n,，]/).map((s) => s.trim()).filter(Boolean)
    const names = Array.from(new Set([...selectedRemoteModels, ...manual]))
    if (names.length === 0) return
    const providerLabel = PROVIDER_PRESETS.find((p) => p.id === batchProvider)?.label ?? batchProvider
    await get().run(async () => {
      let firstId: string | null = null
      for (const model of names) {
        const profile: ModelProfile = {
          id: `model_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name: `${providerLabel} · ${model}`,
          provider: batchProvider,
          baseUrl: batchBaseUrl,
          apiKey: batchApiKey,
          model,
          temperature: 0.8,
          maxTokens: 4096,
          enabled: true,
        }
        await call('models:save', { profile })
        if (!firstId) firstId = profile.id
      }
      const models = await call('models:list', undefined)
      set((s) => ({ models, activeModelId: s.activeModelId ?? firstId, selectedRemoteModels: [], batchModelNames: '' }))
      get().notify(`已添加 ${names.length} 个模型`)
    })
  },

  openAppSettings() {
    set({ showAppSettings: true })
  },

  closeAppSettings() {
    set({ showAppSettings: false })
  },

  async setTheme(theme) {
    set((s) => ({ settings: { ...s.settings, theme } }))
    await call('settings:set', { settings: { theme } }).catch(() => undefined)
  },

  // ── 聊天 ──

  setChatInput(text) {
    set({ chatInput: text })
  },

  clearChat() {
    set({ chatMessages: [], chatInput: '' })
  },

  async sendChat() {
    const { chatInput, chatBusy, chatMessages, activeModelId, editorText, editorTitle } = get()
    const text = chatInput.trim()
    if (!text || chatBusy) return
    const history: ChatMessage[] = [...chatMessages, { role: 'user', content: text }]
    const contextText = editorText.length > 12000 ? `${editorText.slice(0, 12000)}\n…（正文过长，仅显示前 12000 字；如需全文请分段）` : editorText
    const contextBlock = `【当前编辑上下文（实时同步）】\n章节标题：${editorTitle || '（未设置）'}\n正文：\n${contextText || '（空）'}`
    const systemPrompt = [
      '你是大肥鱼的小说工坊内置写作助手，运行在桌面小说创作软件中。',
      '你可以读取用户当前正在编辑的正文（见下方【当前编辑上下文】），并直接修改上方编辑框。',
      '',
      '规则：',
      '1. 如果用户要求“生成/修改/扩写/增加字数/重写/润色/删减”等涉及正文内容的任务，你必须基于上下文中的正文，输出修改后的【完整正文】，不得省略、不得只给建议。',
      '2. 完整正文必须严格包裹在标记之间：',
      '【编辑框结果】',
      '<完整正文>',
      '【结束】',
      '3. 如果只是回答解释、写作建议、查世界书、诊断分析等，正常对话即可，不要使用上述标记。',
      '4. “增加100字”“扩写”等指令必须实际修改正文并输出完整结果。',
      '',
      contextBlock,
    ].join('\n')
    const opId = newOpId()
    set({ chatMessages: history, chatInput: '', chatBusy: true, streamOpId: opId, streamTarget: 'chat', streamText: '', activeOpId: opId })
    await get().run(async () => {
      try {
        const result = await call('agent:chatStream', {
          profileId: activeModelId ?? undefined,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history,
          ],
          maxTokens: 4000,
          opId,
        })
        const applyStart = '【编辑框结果】'
        const applyEnd = '【结束】'
        const startIdx = result.text.indexOf(applyStart)
        const endIdx = startIdx >= 0 ? result.text.indexOf(applyEnd, startIdx + applyStart.length) : -1
        let display = result.text
        let applied: string | null = null
        if (startIdx >= 0 && endIdx > startIdx) {
          applied = result.text.slice(startIdx + applyStart.length, endIdx).trim()
          const before = result.text.slice(0, startIdx).trim()
          const after = result.text.slice(endIdx + applyEnd.length).trim()
          display = [before, after].filter(Boolean).join('\n') || '我已按你的要求修改了正文，请在右侧确认后应用。'
        }
        if (result.aborted) display += '\n\n（已停止生成）'
        if (applied !== null) {
          // 不直接覆盖编辑器，右栏给出 diff 预览，由用户确认应用
          const currentText = get().editorText
          set({ rightPanel: { kind: 'diff', original: currentText, next: applied } })
          get().notify('AI 给出了修改建议，请在右侧确认应用')
        }
        set((s) => ({ chatMessages: [...history, { role: 'assistant', content: display }], streamOpId: null, streamTarget: null, streamText: '' }))
      } catch (error) {
        const partial = get().streamText
        set((s) => ({
          chatMessages: [...history, { role: 'assistant', content: partial.trim() ? `${partial}\n\n⚠ 已中断：${errorMessage(error)}` : `⚠ 出错了：${errorMessage(error)}` }],
          streamOpId: null, streamTarget: null, streamText: '',
        }))
      } finally {
        set({ chatBusy: false, activeOpId: null })
      }
    })
  },

  applyStreamChunk(opId, delta) {
    if (get().streamOpId !== opId) return
    set((s) => ({ streamText: s.streamText + delta }))
  },

  async cancelActiveOp() {
    const opId = get().activeOpId
    if (!opId) return
    await call('agent:abortStream', { opId }).catch(() => undefined)
  },

  // ── 阅读 / 字号 ──

  async openReader() {
    await get().run(async () => {
      const result = await call('reader:open', undefined)
      if (!result.path) return
      if (result.openedExternal) {
        get().notify('已用系统默认程序打开')
        return
      }
      set({ reader: { path: result.path, ext: result.ext, text: result.text } })
    })
  },

  closeReader() {
    set({ reader: null })
  },

  async setFontSize(size) {
    const fontSize = Math.max(12, Math.min(28, size))
    set((s) => ({ fontSize, settings: { ...s.settings, fontSize } }))
    await call('settings:set', { settings: { fontSize } }).catch(() => undefined)
  },
}))
