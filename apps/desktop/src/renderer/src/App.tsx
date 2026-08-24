import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppInfo, AppSettings, ChapterWithText, LorebookSnapshot, WorkspaceInfo } from '@dafuyu/contracts'
import type { BookSummary } from '@dafuyu/core/novel'

const GENRES = [
  ['fantasy', '玄幻'], ['xianxia', '仙侠'], ['wuxia', '武侠'], ['urban', '都市'], ['scifi', '科幻'],
  ['mystery', '悬疑'], ['horror', '惊悚'], ['romance', '言情'], ['ancient-romance', '古言'], ['game', '游戏'],
  ['light-novel', '轻小说'], ['history', '历史'], ['military', '军事'], ['business', '商战'], ['strategy', '权谋'],
] as const

interface UiState {
  info: AppInfo | null
  workspace: WorkspaceInfo | null
  settings: AppSettings
  projects: BookSummary[]
  selectedProjectId: string | null
  chapters: Array<{ no: number; title: string; words: number; updatedAt: string }>
  selectedChapterNo: number | null
  chapter: ChapterWithText | null
  lorebook: LorebookSnapshot | null
  editorText: string
  editorTitle: string
  error: string | null
  busy: boolean
}

const initialUi: UiState = {
  info: null,
  workspace: null,
  settings: {},
  projects: [],
  selectedProjectId: null,
  chapters: [],
  selectedChapterNo: null,
  chapter: null,
  lorebook: null,
  editorText: '',
  editorTitle: '',
  error: null,
  busy: false,
}

async function call<K extends keyof import('@dafuyu/contracts').CommandMap>(
  command: K,
  payload: import('@dafuyu/contracts').CommandRequest<K>,
): Promise<import('@dafuyu/contracts').CommandResponse<K>> {
  const result = await window.novelWorkshop.invoke(command, payload)
  if (result.ok) return result.value
  throw new Error(result.error.message)
}

export function App(): JSX.Element {
  const [state, setState] = useState<UiState>(initialUi)

  const patch = useCallback((part: Partial<UiState>) => {
    setState((prev) => ({ ...prev, ...part }))
  }, [])

  const run = useCallback(async (action: () => Promise<void>) => {
    patch({ busy: true, error: null })
    try {
      await action()
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      patch({ busy: false })
    }
  }, [patch])

  const refreshWorkspace = useCallback(async () => {
    const [info, workspace, settings, projects] = await Promise.all([
      call('app:getInfo', undefined),
      call('workspace:get', undefined),
      call('settings:get', undefined),
      call('projects:list', undefined),
    ])
    patch({ info, workspace, settings, projects })
  }, [patch])

  useEffect(() => {
    void run(refreshWorkspace)
  }, [run, refreshWorkspace])

  const chooseWorkspace = useCallback(() => {
    void run(async () => {
      const path = await call('workspace:choose', undefined)
      if (path) {
        await refreshWorkspace()
        patch({ selectedProjectId: null, selectedChapterNo: null, chapter: null, chapters: [], lorebook: null })
      }
    })
  }, [run, refreshWorkspace])

  const createProject = useCallback((title: string, genre: string) => {
    void run(async () => {
      const book = await call('projects:create', { title, genre })
      await refreshWorkspace()
      patch({ selectedProjectId: book.id, selectedChapterNo: null, chapter: null, chapters: [] })
      await loadProject(book.id)
    })
  }, [run, refreshWorkspace])

  const loadProject = useCallback(async (projectId: string) => {
    patch({ selectedProjectId: projectId, selectedChapterNo: null, chapter: null, editorText: '', editorTitle: '' })
    const [chapters, lorebook] = await Promise.all([
      call('chapters:list', { projectId }),
      call('lorebook:list', { bookId: projectId }),
    ])
    patch({ chapters, lorebook })
  }, [patch])

  const openProject = useCallback((projectId: string) => {
    void run(async () => {
      await loadProject(projectId)
    })
  }, [run, loadProject])

  const loadChapter = useCallback((projectId: string, chapterNo: number) => {
    void run(async () => {
      const chapter = await call('chapters:get', { projectId, chapterNo })
      if (chapter) {
        patch({ selectedChapterNo: chapterNo, chapter, editorText: chapter.content, editorTitle: chapter.chapter.title })
      }
    })
  }, [run, patch])

  const saveChapter = useCallback(() => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo) return
    const { editorTitle, editorText, chapter } = state
    void run(async () => {
      const saved = await call('chapters:save', {
        projectId,
        chapterNo,
        title: editorTitle,
        text: editorText,
      })
      patch({ chapter: chapter ? { ...chapter, chapter: saved } : chapter })
      const chapters = await call('chapters:list', { projectId })
      patch({ chapters })
    })
  }, [run, state])

  const newChapter = useCallback(() => {
    if (!state.selectedProjectId) return
    const next = state.chapters.length > 0 ? Math.max(...state.chapters.map((c) => c.no)) + 1 : 1
    patch({ selectedChapterNo: next, chapter: null, editorText: '', editorTitle: `第 ${next} 章` })
  }, [state.selectedProjectId, state.chapters, patch])

  const saveLoreEntry = useCallback((entry: import('@dafuyu/core/types').LoreEntry) => {
    const projectId = state.selectedProjectId
    if (!projectId) return
    void run(async () => {
      await call('lorebook:saveEntry', { entry })
      const lorebook = await call('lorebook:list', { bookId: projectId })
      patch({ lorebook })
    })
  }, [run, state.selectedProjectId, patch])

  const deleteLoreEntry = useCallback((id: string) => {
    const projectId = state.selectedProjectId
    if (!projectId) return
    void run(async () => {
      await call('lorebook:deleteEntry', { id })
      const lorebook = await call('lorebook:list', { bookId: projectId })
      patch({ lorebook })
    })
  }, [run, state.selectedProjectId, patch])

  const selectedBook = useMemo(() => state.projects.find((p) => p.id === state.selectedProjectId) ?? null, [state.projects, state.selectedProjectId])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>大肥鱼的小说工坊</strong>
          <span className="version">{state.info?.version ?? '…'}</span>
        </div>
        <div className="workspace">
          <span className="path">{state.workspace?.path ?? '未选择工作区'}</span>
          <button onClick={chooseWorkspace} disabled={state.busy}>选择工作区</button>
        </div>
      </header>

      {state.error && <div className="error-bar">{state.error}</div>}

      <div className="layout">
        <aside className="sidebar left">
          <div className="panel-title">
            作品库
            <button onClick={() => {
              const title = window.prompt('新作品标题')
              const genre = window.prompt('题材 id（如 fantasy/xianxia/urban）', 'fantasy')
              if (title && genre) createProject(title, genre)
            }}>＋</button>
          </div>
          <div className="project-list">
            {state.projects.map((book) => (
              <button
                key={book.id}
                className={`project-item ${book.id === state.selectedProjectId ? 'active' : ''}`}
                onClick={() => openProject(book.id)}
              >
                <span className="title">{book.title || '未命名'}</span>
                <span className="meta">{book.genre} · {book.chapterCount} 章 · {book.totalWords} 字</span>
              </button>
            ))}
            {state.projects.length === 0 && <div className="empty">还没有作品，点击 ＋ 创建</div>}
          </div>

          {selectedBook && (
            <div className="chapter-list">
              <div className="panel-title">
                章节
                <button onClick={newChapter}>＋</button>
              </div>
              {state.chapters.map((ch) => (
                <button
                  key={ch.no}
                  className={`chapter-item ${ch.no === state.selectedChapterNo ? 'active' : ''}`}
                  onClick={() => selectedBook && loadChapter(selectedBook.id, ch.no)}
                >
                  {ch.title || `第 ${ch.no} 章`} <small>{ch.words} 字</small>
                </button>
              ))}
              {state.chapters.length === 0 && <div className="empty">还没有章节</div>}
            </div>
          )}
        </aside>

        <main className="editor">
          {state.selectedProjectId ? (
            <>
              <div className="editor-toolbar">
                <input
                  className="chapter-title"
                  value={state.editorTitle}
                  onChange={(e) => patch({ editorTitle: e.target.value })}
                  placeholder="章节标题"
                />
                <button onClick={saveChapter} disabled={state.busy || !state.selectedChapterNo}>保存</button>
              </div>
              <textarea
                className="chapter-editor"
                value={state.editorText}
                onChange={(e) => patch({ editorText: e.target.value })}
                placeholder="在此输入正文…"
                spellCheck={false}
              />
            </>
          ) : (
            <div className="welcome">
              <h1>欢迎使用大肥鱼的小说工坊</h1>
              <p>选择或创建一个工作区，然后开始创作。</p>
            </div>
          )}
        </main>

        <aside className="sidebar right">
          <div className="panel-title">世界书</div>
          {state.lorebook ? (
            <div className="lorebook-list">
              {state.lorebook.entries.map((entry) => (
                <div className="lore-entry" key={entry.id}>
                  <div className="lore-entry-head">
                    <strong>{entry.name}</strong>
                    <span>
                      <button onClick={() => {
                        const content = window.prompt('条目内容', entry.content)
                        if (content !== null) saveLoreEntry({ ...entry, content })
                      }}>改</button>
                      <button onClick={() => deleteLoreEntry(entry.id)}>删</button>
                    </span>
                  </div>
                  <p>{entry.content.slice(0, 80)}</p>
                </div>
              ))}
              {state.lorebook.entries.length === 0 && <div className="empty">暂无世界书条目</div>}
              <button
                className="add-lore"
                onClick={() => {
                  const name = window.prompt('条目名称')
                  const content = window.prompt('条目内容')
                  if (name && content && state.selectedProjectId) {
                    saveLoreEntry({
                      id: `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                      name,
                      content,
                      keywords: [],
                      is_regex: false,
                      case_sensitive: false,
                      always_active: false,
                      enabled: true,
                      priority: 50,
                      scan_depth: 0,
                      inject_target: 'system',
                      inject_position: 'append',
                      insertion_depth: 0,
                      book_id: state.selectedProjectId,
                      volume_id: undefined,
                      tags: [],
                      version: 1,
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    })
                  }
                }}
              >
                ＋ 新增条目
              </button>
            </div>
          ) : (
            <div className="empty">打开作品后显示世界书</div>
          )}
        </aside>
      </div>
    </div>
  )
}
