/**
 * WorkspaceService — 桌面版本地数据服务。
 * 复用 @dafuyu/core 的纯领域层，负责工作区路径、项目、章节、世界书、提示词。
 * 本类只运行在主进程，渲染进程不直接触碰文件系统。
 */
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { NovelStore, NovelService } from '@dafuyu/core/novel'
import { LoreStore, LoreService } from '@dafuyu/core/lorebook'
import { VariableStoreFile, variablesFilePath } from '@dafuyu/core/variables'
import { loadPromptLibrary } from '@dafuyu/core/prompts'
import { atomicWriteFile, readOptional } from '@dafuyu/core/atomic-file'
import { countChapter, checkWordTarget } from '@dafuyu/core/stats'
import { scanAiTaste, splitPolishSuggestions, applyPolishSuggestions } from '@dafuyu/core/polish'
import type { PolishSuggestion } from '@dafuyu/core/polish'
import { validateChapter, BUILTIN_RULES } from '@dafuyu/core/validation'
import { diagnoseFirstChapters } from '@dafuyu/core/diagnose'
import { detectLedgerConflicts, detectTimelineAnomalies, suggestSediment } from '@dafuyu/core/consistency'
import { LedgerStore, TimelineStore, ledgerFilePath, timelineFilePath } from '@dafuyu/core/consistency'
import { ForeshadowStore, GlossaryStore, IdeaStore, foreshadowFilePath, glossaryFilePath, ideasFilePath } from '@dafuyu/core/auxiliary'
import { createWizard, parseIntent, wizardCommit, wizardNext, wizardSkip } from '@dafuyu/core/guide'
import { exportBook } from '@dafuyu/core/export'
import { BookImporter, parseBookFile } from '@dafuyu/core/importer'
import type { Book, BookSummary, Chapter } from '@dafuyu/core/novel'
import type { LoreEntry, PromptTemplate, ChapterStats } from '@dafuyu/core/types'
import type { AuditEvent, PhaseId } from '@dafuyu/core/workflow'
import type { ContextPacket } from '@dafuyu/core/context'
import type { Golden3Report } from '@dafuyu/core/diagnose'
import type { ValidationReport } from '@dafuyu/core/validation'
import type { ConsistencyAuditReport } from '@dafuyu/core/consistency'
import type { WizardState } from '@dafuyu/core/guide'
import type { ImportResult } from '@dafuyu/core/importer'
import type { ChapterListItem, ChapterWithText, LibraryEntry, LorebookSnapshot, ProjectPhaseArtifact, WorkspaceInfo } from '@dafuyu/contracts'

export interface WorkspaceDeps {
  /** 提示词/技能等随包资源目录 */
  resourcesDir: string
  /** 持久化应用设置读写（返回 null 表示无工作区） */
  loadSettings: () => Promise<Record<string, unknown>>
  saveSettings: (settings: Record<string, unknown>) => Promise<void>
}

export class WorkspaceService {
  private workspacePath: string | null = null
  private novelStore: NovelStore | null = null
  private loreStore: LoreStore | null = null
  private variables: VariableStoreFile | null = null
  private novel: NovelService | null = null
  private lore: LoreService | null = null

  constructor(private readonly deps: WorkspaceDeps) {}

  getWorkspacePath(): string | null {
    return this.workspacePath
  }

  async init(): Promise<void> {
    const settings = await this.deps.loadSettings()
    const raw = settings.workspacePath
    if (typeof raw === 'string' && raw.trim()) {
      await this.setWorkspace(raw.trim()).catch(() => {
        // 工作区不可用时保持未初始化，等待用户重新选择
        this.workspacePath = null
        this.novelStore = null
        this.loreStore = null
        this.variables = null
        this.novel = null
        this.lore = null
      })
    }
  }

  async setWorkspace(path: string): Promise<WorkspaceInfo> {
    const normalized = path.trim()
    if (!normalized) throw new Error('工作区路径不能为空')
    mkdirSync(join(normalized, 'projects'), { recursive: true, mode: 0o700 })
    mkdirSync(join(normalized, 'lorebook'), { recursive: true, mode: 0o700 })
    this.workspacePath = normalized
    this.novelStore = new NovelStore(join(normalized, 'projects'))
    this.loreStore = new LoreStore(join(normalized, 'lorebook'))
    this.variables = new VariableStoreFile(variablesFilePath(join(normalized, 'projects')))
    this.novel = new NovelService({ store: this.novelStore, loreStore: this.loreStore, variables: this.variables })
    this.lore = new LoreService(this.loreStore)
    await this.deps.saveSettings({ ...(await this.deps.loadSettings()), workspacePath: normalized })
    const info = await this.getWorkspaceInfo()
    if (!info) throw new Error('工作区初始化失败')
    return info
  }

  async getWorkspaceInfo(): Promise<WorkspaceInfo | null> {
    if (!this.workspacePath || !this.novelStore || !this.loreStore) return null
    const [books, entries] = await Promise.all([
      this.novelStore.listBooks(),
      this.loreStore.readEntries().catch(() => [] as LoreEntry[]),
    ])
    return { path: this.workspacePath, bookCount: books.length, loreEntryCount: entries.length }
  }

  private requireNovel(): NovelService {
    if (!this.novel) throw new Error('尚未选择工作区')
    return this.novel
  }

  private requireLore(): LoreService {
    if (!this.lore) throw new Error('尚未选择工作区')
    return this.lore
  }

  private requireStore(): NovelStore {
    if (!this.novelStore) throw new Error('尚未选择工作区')
    return this.novelStore
  }

  // ── 项目 ──

  listProjects(): Promise<BookSummary[]> {
    return this.requireNovel().listProjects()
  }

  createProject(title: string, genre: string): Promise<Book> {
    return this.requireNovel().createProject(title, genre)
  }

  getProject(id: string): Promise<Book> {
    return this.requireNovel().load(id)
  }

  deleteProject(id: string, keepChapters: boolean): Promise<{ deleted: boolean; keptChapters: boolean }> {
    return this.requireNovel().deleteProject(id, keepChapters)
  }

  async listArtifacts(id: string): Promise<ProjectPhaseArtifact[]> {
    const store = this.requireStore()
    const phases = ['topic', 'setting', 'character', 'outline', 'volume', 'chapter'] as const
    const items: ProjectPhaseArtifact[] = []
    for (const phase of phases) {
      items.push({ phase, content: (await store.readArtifact(id, phase)) ?? null })
    }
    return items
  }

  // ── 章节 ──

  async listChapters(projectId: string): Promise<ChapterListItem[]> {
    const store = this.requireStore()
    const numbers = await store.listChapterNumbers(projectId)
    const items: ChapterListItem[] = []
    for (const no of numbers) {
      const chapter = await store.readChapter(projectId, no)
      if (chapter) items.push({ no, title: chapter.chapter.title, words: chapter.chapter.words, updatedAt: chapter.chapter.updatedAt })
    }
    return items
  }

  async getChapter(projectId: string, chapterNo: number): Promise<ChapterWithText | null> {
    const chapter = await this.requireStore().readChapter(projectId, chapterNo)
    return chapter ? { chapter: chapter.chapter, content: chapter.content } : null
  }

  saveChapter(projectId: string, chapterNo: number, title: string, text: string, brief?: string): Promise<Chapter> {
    return this.requireNovel().saveChapter(projectId, chapterNo, title, text, brief)
  }

  async chapterStats(projectId: string, chapterNo: number) {
    return (await this.requireNovel().chapterStats(projectId, chapterNo)) ?? null
  }

  // ── 世界书 ──

  async listLorebook(bookId?: string): Promise<LorebookSnapshot> {
    const lore = this.requireLore()
    const [entries, groups] = await Promise.all([lore.listEntries(), lore.listGroups()])
    const filtered = bookId ? entries.filter((e) => !e.book_id || e.book_id === bookId) : entries
    return { entries: filtered, groups }
  }

  async saveLoreEntry(entry: LoreEntry): Promise<LoreEntry> {
    const lore = this.requireLore()
    const existing = await lore.getEntry(entry.id).catch(() => undefined)
    if (existing) {
      return await lore.updateEntry(entry.id, {
        name: entry.name,
        content: entry.content,
        keywords: entry.keywords,
        is_regex: entry.is_regex,
        case_sensitive: entry.case_sensitive,
        always_active: entry.always_active,
        enabled: entry.enabled,
        priority: entry.priority,
        scan_depth: entry.scan_depth,
        inject_target: entry.inject_target,
        inject_position: entry.inject_position,
        insertion_depth: entry.insertion_depth,
        book_id: entry.book_id,
        volume_id: entry.volume_id,
        tags: entry.tags,
        note: entry.note,
      })
    }
    return await lore.createEntry({
      name: entry.name,
      content: entry.content,
      keywords: entry.keywords,
      is_regex: entry.is_regex,
      case_sensitive: entry.case_sensitive,
      always_active: entry.always_active,
      enabled: entry.enabled,
      priority: entry.priority,
      scan_depth: entry.scan_depth,
      inject_target: entry.inject_target,
      inject_position: entry.inject_position,
      insertion_depth: entry.insertion_depth,
      book_id: entry.book_id,
      volume_id: entry.volume_id,
      tags: entry.tags,
      note: entry.note,
    })
  }

  async deleteLoreEntry(id: string): Promise<void> {
    await this.requireLore().deleteEntry(id)
  }

  async importLorebookJson(content: string, bookId?: string) {
    const result = await this.requireLore().importEntries({ content, book_id: bookId })
    return { imported: result.imported_count, warnings: result.warnings }
  }

  // ── 提示词 ──

  listPrompts(): Promise<PromptTemplate[]> {
    return loadPromptLibrary(join(this.deps.resourcesDir, 'prompts'))
  }

  // ── 流程 / 项目高级操作 ──

  enterPhase(projectId: string, phase: PhaseId): Promise<Book> {
    return this.requireNovel().enterPhase(projectId, phase)
  }

  commitPhase(projectId: string, phase: PhaseId, artifact: string, report: { passed: boolean; errorCount: number; warningCount: number }): Promise<Book> {
    return this.requireNovel().commitPhase(projectId, phase, artifact, report)
  }

  overridePhase(projectId: string, phase: PhaseId, action: 'force' | 'reopen' | 'skip' | 'rollback'): Promise<Book> {
    return this.requireNovel().overridePhase(projectId, phase, action)
  }

  audit(projectId: string): Promise<AuditEvent[]> {
    return this.requireNovel().audit(projectId)
  }

  async projectStats(projectId: string) {
    const book = await this.requireNovel().load(projectId)
    return {
      id: book.id,
      title: book.title,
      genre: book.genre,
      status: book.status,
      currentPhase: book.currentPhase,
      stats: book.stats,
      phases: book.phases,
    }
  }

  cloneProject(sourceId: string, options: { title?: string; genre?: string }): Promise<Book> {
    return this.requireNovel().cloneProject(sourceId, options)
  }

  async importText(text: string, options: { title?: string; genre?: string; fileName?: string }): Promise<ImportResult> {
    const parsed = parseBookFile(text, options.fileName ?? 'import.txt')
    const importer = new BookImporter({
      createProject: async (title, genre) => {
        const book = await this.requireNovel().createProject(options.title?.trim() || title, options.genre?.trim() || genre)
        return { id: book.id }
      },
      saveChapter: async (bookId, chapterNo, title, content) => {
        const chapter = await this.requireNovel().saveChapter(bookId, chapterNo, title, content)
        return { words: chapter.words }
      },
      deleteProject: async (bookId) => {
        await this.requireNovel().deleteProject(bookId, false)
      },
    })
    return await importer.importParsed(parsed)
  }

  // ── 写章 / 校验 / 诊断 / 导出 ──

  assembleContext(projectId: string, chapterNo: number, brief?: string): Promise<ContextPacket> {
    return this.requireNovel().assemble(projectId, chapterNo, brief)
  }

  async validateChapter(projectId: string, chapterNo: number, title: string, text: string, brief?: string): Promise<ValidationReport> {
    const book = await this.requireNovel().load(projectId)
    const ledger = await new LedgerStore(ledgerFilePath(this.requireStore().getBookDir(projectId))).all()
    return validateChapter(BUILTIN_RULES, {
      book,
      chapterNo,
      title,
      text,
      brief,
      forbiddenWords: book.config.style.forbiddenWords,
      ledger,
    })
  }

  async diagnoseChapters(projectId: string, chapterStart: number, count = 3): Promise<Golden3Report> {
    const book = await this.requireNovel().load(projectId)
    const store = this.requireStore()
    const chapters: Array<{ no: number; title: string; text: string }> = []
    for (let no = chapterStart; no < chapterStart + count; no += 1) {
      const chapter = await store.readChapter(projectId, no)
      if (chapter) chapters.push({ no, title: chapter.chapter.title, text: chapter.content })
    }
    if (chapters.length === 0) throw new Error('没有可诊断的章节')
    return diagnoseFirstChapters(chapters, { wordTargets: book.config.wordTargets }, chapters.length)
  }

  wordcount(text: string, min?: number, max?: number, useCjk = false): ChapterStats {
    const stats = countChapter(text, 0)
    if (min !== undefined && max !== undefined) return checkWordTarget(stats, min, max, useCjk)
    return stats
  }

  async exportProject(projectId: string, format: 'txt' | 'markdown' | 'platform', options: { authorNotes?: string; splitVolumes?: boolean } = {}) {
    const book = await this.requireNovel().load(projectId)
    const chapters = await this.requireNovel().allChapters(projectId)
    const content = exportBook(chapters, {
      format,
      title: book.title,
      author: book.config.author,
      authorNotes: options.authorNotes,
      splitVolumes: options.splitVolumes,
    })
    const ext = format === 'markdown' ? 'md' : format === 'platform' ? 'txt' : 'txt'
    return { fileName: `${book.title}.${ext}`, content }
  }

  async exportStructured(projectId: string) {
    const book = await this.requireNovel().load(projectId)
    const chapters = await this.requireNovel().allChapters(projectId)
    return {
      title: book.title,
      author: book.config.author ?? '',
      chapters: chapters.map(({ chapter, content }) => ({ no: chapter.no, title: chapter.title, content })),
    }
  }

  // ── 润色纯函数（LLM 结果接入后使用） ──

  splitPolish(original: string, polished: string): PolishSuggestion[] {
    return splitPolishSuggestions(original, polished)
  }

  applyPolish(original: string, suggestions: readonly PolishSuggestion[]): string {
    return applyPolishSuggestions(original, suggestions)
  }

  aiTasteScan(text: string) {
    return scanAiTaste(text)
  }

  // ── 世界书分组 ──

  async listLorebookGroups(): Promise<import('@dafuyu/core/types').LoreGroup[]> {
    return await this.requireLore().listGroups()
  }

  createLoreGroup(params: { name: string; entry_ids?: string[]; book_ids?: string[]; enabled?: boolean }) {
    return this.requireLore().createGroup(params)
  }

  updateLoreGroup(params: import('@dafuyu/core/lorebook').UpdateGroupParams) {
    return this.requireLore().updateGroup(params)
  }

  deleteLoreGroup(id: string, deleteEntries: boolean) {
    return this.requireLore().deleteGroup(id, deleteEntries)
  }

  moveLoreEntry(entryId: string, targetGroupId?: string) {
    return this.requireLore().moveEntryToGroup(entryId, targetGroupId)
  }

  // ── 伏笔 / 术语 / 灵感 ──

  private bookDir(projectId: string): string {
    return this.requireStore().getBookDir(projectId)
  }

  listForeshadows(projectId: string) {
    return new ForeshadowStore(foreshadowFilePath(this.bookDir(projectId))).all()
  }

  plantForeshadow(projectId: string, params: { content: string; plantChapter: number; plannedRevealChapter?: number; related?: string }) {
    return new ForeshadowStore(foreshadowFilePath(this.bookDir(projectId))).plant(params)
  }

  revealForeshadow(projectId: string, id: string, chapterNo: number) {
    return new ForeshadowStore(foreshadowFilePath(this.bookDir(projectId))).reveal(id, chapterNo)
  }

  dropForeshadow(projectId: string, id: string) {
    return new ForeshadowStore(foreshadowFilePath(this.bookDir(projectId))).drop(id)
  }

  listGlossary(projectId: string) {
    return new GlossaryStore(glossaryFilePath(this.bookDir(projectId))).all()
  }

  addGlossary(projectId: string, term: string, definition: string, category?: string) {
    return new GlossaryStore(glossaryFilePath(this.bookDir(projectId))).add(term, definition, category)
  }

  extractGlossaryCandidates(text: string): string[] {
    return GlossaryStore.extractCandidates(text)
  }

  listIdeas(projectId: string, query?: string) {
    return new IdeaStore(ideasFilePath(this.bookDir(projectId))).search(query)
  }

  addIdea(projectId: string, content: string, tags: string[] = []) {
    return new IdeaStore(ideasFilePath(this.bookDir(projectId))).add(content, tags)
  }

  // ── 账本 / 时间线 / 一致性 ──

  async ledger(projectId: string, entity?: string) {
    const store = new LedgerStore(ledgerFilePath(this.bookDir(projectId)))
    return entity ? await store.byEntity(entity) : await store.all()
  }

  async timeline(projectId: string) {
    return await new TimelineStore(timelineFilePath(this.bookDir(projectId))).all()
  }

  async recordTimeline(projectId: string, event: { chapterNo: number; bookTime: string; event: string }) {
    return await new TimelineStore(timelineFilePath(this.bookDir(projectId))).record(event)
  }

  async consistencyAudit(projectId: string): Promise<ConsistencyAuditReport> {
    const bookDir = this.bookDir(projectId)
    const book = await this.requireNovel().load(projectId)
    const [entries, events] = await Promise.all([
      new LedgerStore(ledgerFilePath(bookDir)).all(),
      new TimelineStore(timelineFilePath(bookDir)).all(),
    ])
    return {
      auditedThroughChapter: book.stats.chapterCount,
      conflicts: detectLedgerConflicts(entries),
      timelineIssues: detectTimelineAnomalies(events),
      sedimentSuggestions: suggestSediment(entries),
      ranAt: new Date().toISOString(),
    }
  }

  // ── 向导 / 意图 ──

  private async readWizard(projectId: string): Promise<WizardState> {
    const path = join(this.bookDir(projectId), 'wizard.json')
    const text = await readOptional(path)
    return text ? JSON.parse(text) as WizardState : createWizard(new Date().toISOString())
  }

  private async writeWizard(projectId: string, state: WizardState): Promise<WizardState> {
    await atomicWriteFile(join(this.bookDir(projectId), 'wizard.json'), `${JSON.stringify(state, null, 2)}\n`)
    return state
  }

  async wizardStatus(projectId: string): Promise<WizardState> {
    return await this.readWizard(projectId)
  }

  async wizardAction(projectId: string, action: 'commit' | 'next' | 'skip', step?: WizardState['step'], artifact?: string): Promise<{ wizard: WizardState; nextStep?: WizardState['step'] | null }> {
    const now = new Date().toISOString()
    const current = await this.readWizard(projectId)
    if (action === 'skip' && step) {
      const result = wizardSkip(current, step, now)
      if (!result.ok) throw result.error
      return { wizard: await this.writeWizard(projectId, result.value) }
    }
    if (action === 'commit' && step) {
      const result = wizardCommit(current, step, artifact ?? '', now)
      if (!result.ok) throw result.error
      return { wizard: await this.writeWizard(projectId, result.value) }
    }
    const result = wizardNext(current, now)
    if (!result.ok) throw result.error
    return { wizard: await this.writeWizard(projectId, result.value.state), nextStep: result.value.step }
  }

  // ── 本地库（素材/技能） ──

  private libraryFile(): string {
    if (!this.workspacePath) throw new Error('尚未选择工作区')
    return join(this.workspacePath, 'library', 'library.json')
  }

  private async readLibrary(): Promise<LibraryEntry[]> {
    const text = await readOptional(this.libraryFile())
    if (text === undefined) return []
    try {
      const parsed = JSON.parse(text) as { data?: LibraryEntry[] } | LibraryEntry[]
      if (Array.isArray(parsed)) return parsed
      if (parsed && Array.isArray(parsed.data)) return parsed.data
      return []
    } catch {
      return []
    }
  }

  private async writeLibrary(entries: LibraryEntry[]): Promise<void> {
    const dir = join(this.libraryFile(), '..')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await atomicWriteFile(this.libraryFile(), `${JSON.stringify({ schemaVersion: 1, data: entries }, null, 2)}\n`)
  }

  async listLibrary(options: { kind?: 'material' | 'skill'; query?: string } = {}): Promise<LibraryEntry[]> {
    const entries = await this.readLibrary()
    const needle = options.query?.trim().toLowerCase()
    return entries
      .filter((e) => !options.kind || e.kind === options.kind)
      .filter((e) => !needle || e.title.toLowerCase().includes(needle) || e.content.toLowerCase().includes(needle) || e.tags.some((t) => t.toLowerCase().includes(needle)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async saveLibraryEntry(entry: LibraryEntry): Promise<LibraryEntry> {
    const entries = await this.readLibrary()
    const now = new Date().toISOString()
    const existing = entries.findIndex((e) => e.id === entry.id)
    const saved: LibraryEntry = { ...entry, updatedAt: now, createdAt: existing >= 0 ? entries[existing]!.createdAt : now }
    if (existing >= 0) entries[existing] = saved
    else entries.push(saved)
    await this.writeLibrary(entries)
    return saved
  }

  async deleteLibraryEntry(id: string): Promise<void> {
    const entries = await this.readLibrary()
    await this.writeLibrary(entries.filter((e) => e.id !== id))
  }

  parseIntent(text: string) {
    return parseIntent(text)
  }
}
