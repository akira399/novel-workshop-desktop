/**
 * WorkspaceService — 桌面版本地数据服务。
 * 复用 @dafuyu/core 的纯领域层，负责工作区路径、项目、章节、世界书、提示词。
 * 本类只运行在主进程，渲染进程不直接触碰文件系统。
 */
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { NovelStore } from '@dafuyu/core/novel'
import { NovelService } from '@dafuyu/core/novel'
import { LoreStore } from '@dafuyu/core/lorebook'
import { LoreService } from '@dafuyu/core/lorebook'
import { VariableStoreFile, variablesFilePath } from '@dafuyu/core/variables'
import { loadPromptLibrary } from '@dafuyu/core/prompts'
import type { Book, BookSummary, Chapter } from '@dafuyu/core/novel'
import type { LoreEntry, PromptTemplate } from '@dafuyu/core/types'
import type { ChapterListItem, ChapterWithText, LorebookSnapshot, ProjectPhaseArtifact, WorkspaceInfo } from '@dafuyu/contracts'

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
}
