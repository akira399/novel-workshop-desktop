import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo, AppSettings, ChapterWithText, LibraryEntry, LorebookSnapshot, ModelProfile, WorkspaceInfo } from '@dafuyu/contracts'
import type { BookSummary } from '@dafuyu/core/novel'
import type { LoreEntry } from '@dafuyu/core/types'

const GENRES = [
  ['fantasy', '玄幻'], ['xianxia', '仙侠'], ['wuxia', '武侠'], ['urban', '都市'], ['scifi', '科幻'],
  ['mystery', '悬疑'], ['horror', '惊悚'], ['romance', '言情'], ['ancient-romance', '古言'], ['game', '游戏'],
  ['light-novel', '轻小说'], ['history', '历史'], ['military', '军事'], ['business', '商战'], ['strategy', '权谋'],
] as const

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface PromptRequest {
  title: string
  defaultValue: string
  resolve: (value: string | null) => void
}

interface AlertRequest {
  title: string
  message: string
  resolve: () => void
}

const emptyModel: ModelProfile = {
  id: '', name: '', provider: 'custom', baseUrl: '', apiKey: '', model: '',
  temperature: 0.8, maxTokens: 4096, enabled: true,
}

interface UiState {
  info: AppInfo | null
  workspace: WorkspaceInfo | null
  settings: AppSettings
  projects: BookSummary[]
  selectedProjectId: string | null
  book: { id: string; title: string; genre: string; currentPhase: string; stats: { totalWords: number; chapterCount: number } } | null
  chapters: Array<{ no: number; title: string; words: number; updatedAt: string }>
  selectedChapterNo: number | null
  chapter: ChapterWithText | null
  editorText: string
  editorTitle: string
  undoStack: string[]
  redoStack: string[]
  findOpen: boolean
  findText: string
  replaceText: string
  fontSize: number
  view: 'projects' | 'lorebook'
  lorebook: LorebookSnapshot | null
  library: LibraryEntry[]
  models: ModelProfile[]
  modelDraft: ModelProfile
  showSettings: boolean
  reader: { path: string; ext: string; text: string | null } | null
  chatMessages: ChatMessage[]
  chatInput: string
  chatBusy: boolean
  promptRequest: PromptRequest | null
  alertRequest: AlertRequest | null
  error: string | null
  notice: string | null
  busy: boolean
}

const initialUi: UiState = {
  info: null, workspace: null, settings: {}, projects: [], selectedProjectId: null, book: null,
  chapters: [], selectedChapterNo: null, chapter: null, editorText: '', editorTitle: '',
  undoStack: [], redoStack: [], findOpen: false, findText: '', replaceText: '', fontSize: 16,
  view: 'projects', lorebook: null, library: [], models: [], modelDraft: emptyModel,
  showSettings: false, reader: null, chatMessages: [], chatInput: '', chatBusy: false,
  promptRequest: null, alertRequest: null, error: null, notice: null, busy: false,
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
  const editorRef = useRef<HTMLTextAreaElement | null>(null)

  const patch = useCallback((part: Partial<UiState>) => setState((prev) => ({ ...prev, ...part })), [])
  const run = useCallback(async (action: () => Promise<void>, successNotice?: string) => {
    patch({ busy: true, error: null, notice: null })
    try {
      await action()
      if (successNotice) patch({ notice: successNotice })
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      patch({ busy: false })
    }
  }, [patch])

  const askPrompt = useCallback((title: string, defaultValue = '') => new Promise<string | null>((resolve) => {
    patch({ promptRequest: { title, defaultValue, resolve } })
  }), [patch])

  const showAlert = useCallback((message: string, title = '提示') => new Promise<void>((resolve) => {
    patch({ alertRequest: { title, message, resolve } })
  }), [patch])

  const refreshWorkspace = useCallback(async () => {
    const [info, workspace, settings, projects, library] = await Promise.all([
      call('app:getInfo', undefined), call('workspace:get', undefined), call('settings:get', undefined),
      call('projects:list', undefined), call('library:list', {}),
    ])
    patch({ info, workspace, settings, projects, library })
  }, [patch])

  useEffect(() => { void run(refreshWorkspace) }, [run, refreshWorkspace])

  const loadModels = useCallback(async () => {
    const models = await call('models:list', undefined)
    patch({ models })
  }, [patch])

  const loadLorebook = useCallback(async (bookId?: string) => {
    const lorebook = await call('lorebook:list', { bookId })
    patch({ lorebook })
  }, [patch])

  const loadProject = useCallback(async (projectId: string) => {
    const [book, chapters] = await Promise.all([
      call('projects:get', { id: projectId }),
      call('chapters:list', { projectId }),
    ])
    await loadLorebook(projectId)
    patch({
      selectedProjectId: projectId,
      book: { id: book.id, title: book.title, genre: book.genre, currentPhase: book.currentPhase, stats: book.stats },
      chapters,
      selectedChapterNo: null, chapter: null, editorText: '', editorTitle: '',
      undoStack: [], redoStack: [], view: 'projects',
    })
  }, [loadLorebook])

  const openProject = useCallback((projectId: string) => { void run(async () => { await loadProject(projectId) }) }, [run, loadProject])

  const createProject = useCallback(async () => {
    const title = await askPrompt('新作品标题')
    if (!title) return
    const genre = await askPrompt('题材 id（如 fantasy/xianxia/urban）', 'fantasy')
    if (!genre) return
    await run(async () => {
      const book = await call('projects:create', { title, genre })
      await refreshWorkspace()
      await loadProject(book.id)
    }, '项目已创建')
  }, [run, askPrompt, refreshWorkspace, loadProject])

  const importFile = useCallback(() => {
    void run(async () => {
      const result = await call('projects:importFile', undefined)
      if (!result) return
      await showAlert(`已导入《${result.title}》：${result.chapterCount} 章 / ${result.totalWords} 字`)
      await refreshWorkspace()
      await loadProject(result.bookId)
    })
  }, [run, showAlert, refreshWorkspace, loadProject])

  const loadChapter = useCallback((projectId: string, chapterNo: number) => {
    void run(async () => {
      const chapter = await call('chapters:get', { projectId, chapterNo })
      if (chapter) {
        patch({ selectedChapterNo: chapterNo, chapter, editorText: chapter.content, editorTitle: chapter.chapter.title, undoStack: [], redoStack: [] })
      }
    })
  }, [run])

  const setEditorText = useCallback((text: string) => {
    setState((prev) => ({
      ...prev,
      undoStack: [...prev.undoStack, prev.editorText].slice(-100),
      redoStack: [],
      editorText: text,
    }))
  }, [])

  const saveChapter = useCallback(() => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo) return
    void run(async () => {
      const saved = await call('chapters:save', { projectId, chapterNo, title: state.editorTitle, text: state.editorText })
      patch({ chapter: state.chapter ? { ...state.chapter, chapter: saved } : state.chapter, undoStack: [], redoStack: [] })
      const chapters = await call('chapters:list', { projectId })
      patch({ chapters })
    }, '章节已保存')
  }, [run, state])

  const newChapter = useCallback(() => {
    if (!state.selectedProjectId) return
    const next = state.chapters.length > 0 ? Math.max(...state.chapters.map((c) => c.no)) + 1 : 1
    patch({ selectedChapterNo: next, chapter: null, editorText: '', editorTitle: `第 ${next} 章`, undoStack: [], redoStack: [] })
  }, [state.selectedProjectId, state.chapters, patch])

  const undo = useCallback(() => {
    setState((prev) => {
      if (prev.undoStack.length === 0) return prev
      const last = prev.undoStack[prev.undoStack.length - 1]!
      return { ...prev, undoStack: prev.undoStack.slice(0, -1), redoStack: [prev.editorText, ...prev.redoStack].slice(0, 100), editorText: last }
    })
  }, [])

  const redo = useCallback(() => {
    setState((prev) => {
      if (prev.redoStack.length === 0) return prev
      const next = prev.redoStack[0]!
      return { ...prev, redoStack: prev.redoStack.slice(1), undoStack: [...prev.undoStack, prev.editorText].slice(-100), editorText: next }
    })
  }, [])

  const doFindReplace = useCallback((replace: boolean) => {
    if (!state.findText) return
    const haystack = state.editorText
    const needle = state.findText
    if (!replace) {
      const idx = haystack.indexOf(needle)
      if (idx >= 0 && editorRef.current) {
        editorRef.current.focus()
        editorRef.current.setSelectionRange(idx, idx + needle.length)
      } else {
        void showAlert('未找到匹配内容')
      }
      return
    }
    const next = haystack.split(needle).join(state.replaceText)
    setEditorText(next)
  }, [state.findText, state.replaceText, state.editorText, setEditorText, showAlert])

  const writeChapterAI = useCallback(() => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo) return
    void run(async () => {
      const result = await call('agent:writeChapter', { projectId, chapterNo })
      setEditorText(result.text)
    }, 'AI 已生成章节')
  }, [run, state.selectedProjectId, state.selectedChapterNo, setEditorText])

  const polishAI = useCallback(() => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo) return
    const text = state.editorText
    void run(async () => {
      const result = await call('agent:polish', { projectId, chapterNo, text })
      setEditorText(result.polished)
    }, '润色完成')
  }, [run, state.selectedProjectId, state.selectedChapterNo, state.editorText, setEditorText])

  const depolishAI = useCallback(() => {
    void run(async () => {
      const result = await call('agent:depolish', { text: state.editorText })
      setEditorText(result.text)
    }, '去 AI 味完成')
  }, [run, state.editorText, setEditorText])

  const styleConvertAI = useCallback(async () => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo) return
    const styleId = await askPrompt('文风模板 id（如 style-xuanhuan / style-urban / style-scifi）', 'style-xuanhuan')
    if (!styleId) return
    await run(async () => {
      const result = await call('agent:styleConvert', { projectId, chapterNo, styleId })
      setEditorText(result.revised)
    }, '文风转换完成')
  }, [run, askPrompt, state.selectedProjectId, state.selectedChapterNo, setEditorText])

  const validateAI = useCallback(() => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo) return
    const editorTitle = state.editorTitle
    const editorText = state.editorText
    void run(async () => {
      const report = await call('chapters:validate', { projectId, chapterNo, title: editorTitle, text: editorText })
      const summary = report.issues.map((i) => `[${i.level}] ${i.message}`).join('\n') || '校验通过，无问题'
      await showAlert(summary, `校验结果：${report.passed ? '通过' : '未通过'}`)
    })
  }, [run, state.selectedProjectId, state.selectedChapterNo, state.editorTitle, state.editorText])

  const diagnoseAI = useCallback(() => {
    const projectId = state.selectedProjectId
    if (!projectId) return
    const chapterStart = state.selectedChapterNo ?? 1
    void run(async () => {
      const report = await call('chapters:diagnose', { projectId, chapterStart, count: 3 })
      await showAlert(report.issues.slice(0, 10).map((i) => `[${i.severity}] ${i.advice}`).join('\n'), `黄金三章诊断：${report.score}/100`)
    })
  }, [run, state.selectedProjectId, state.selectedChapterNo])

  const exportAI = useCallback(async () => {
    const projectId = state.selectedProjectId
    if (!projectId) return
    const format = await askPrompt('导出格式（txt / markdown / platform）', 'markdown')
    if (!format || !['txt', 'markdown', 'platform'].includes(format)) return
    await run(async () => {
      const result = await call('chapters:exportToFile', { projectId, format: format as 'txt' | 'markdown' | 'platform' })
      if (result.path) await showAlert(`已导出到：${result.path}`)
    })
  }, [run, askPrompt, state.selectedProjectId, showAlert])

  const exportRich = useCallback(async () => {
    const projectId = state.selectedProjectId
    if (!projectId) return
    const format = await askPrompt('导出格式（epub / pdf / docx）', 'epub')
    if (!format || !['epub', 'pdf', 'docx'].includes(format)) return
    await run(async () => {
      const result = await call('export:file', { projectId, format: format as 'epub' | 'pdf' | 'docx' })
      if (result.path) await showAlert(`已导出到：${result.path}`)
    })
  }, [run, askPrompt, state.selectedProjectId, showAlert])

  const deleteProject = useCallback(async (keepChapters: boolean) => {
    if (!state.selectedProjectId) return
    const confirm = await askPrompt(keepChapters ? '保留正文，仅删除书籍？输入 yes 确认' : '连同正文一起删除？输入 yes 确认')
    if (confirm !== 'yes') return
    await run(async () => {
      await call('projects:delete', { id: state.selectedProjectId!, keepChapters })
      await refreshWorkspace()
      patch({ selectedProjectId: null, book: null, chapters: [], selectedChapterNo: null, chapter: null, editorText: '', editorTitle: '' })
    }, '已删除')
  }, [run, askPrompt, state.selectedProjectId, refreshWorkspace])

  // ── 世界书 ──
  const saveLoreEntry = useCallback((entry: LoreEntry) => {
    void run(async () => {
      await call('lorebook:saveEntry', { entry })
      await loadLorebook(state.selectedProjectId ?? undefined)
    })
  }, [run, loadLorebook, state.selectedProjectId])

  const deleteLoreEntry = useCallback((id: string) => {
    void run(async () => {
      await call('lorebook:deleteEntry', { id })
      await loadLorebook(state.selectedProjectId ?? undefined)
    })
  }, [run, loadLorebook, state.selectedProjectId])

  // ── 本地库 ──
  const saveLibraryEntry = useCallback((entry: LibraryEntry) => {
    void run(async () => {
      await call('library:save', { entry })
      const library = await call('library:list', {})
      patch({ library })
    })
  }, [run])

  const deleteLibraryEntry = useCallback((id: string) => {
    void run(async () => {
      await call('library:delete', { id })
      const library = await call('library:list', {})
      patch({ library })
    })
  }, [run])

  // ── 模型设置 ──
  const openSettings = useCallback(() => { patch({ showSettings: true }); void loadModels() }, [patch, loadModels])
  const saveModel = useCallback((profile: ModelProfile) => {
    void run(async () => {
      const saved = await call('models:save', { profile })
      const models = await call('models:list', undefined)
      patch({ models, modelDraft: emptyModel })
      await showAlert(`模型「${saved.name}」已保存`)
    })
  }, [run, showAlert])
  const deleteModel = useCallback((id: string) => {
    void run(async () => { await call('models:delete', { id }); const models = await call('models:list', undefined); patch({ models }) })
  }, [run])
  const testModel = useCallback((id: string) => {
    void run(async () => { const result = await call('models:test', { id }); await showAlert(result.message) })
  }, [run, showAlert])

  const openReader = useCallback(() => {
    void run(async () => {
      const result = await call('reader:open', undefined)
      if (!result.path) return
      if (result.openedExternal) { await showAlert(`已用系统默认程序打开：${result.path}`); return }
      patch({ reader: { path: result.path, ext: result.ext, text: result.text } })
    })
  }, [run, showAlert])

  const sendChat = useCallback(() => {
    const text = state.chatInput.trim()
    if (!text || state.chatBusy) return
    const history: ChatMessage[] = [...state.chatMessages, { role: 'user', content: text }]
    patch({ chatMessages: history, chatInput: '', chatBusy: true })
    void run(async () => {
      const result = await call('agent:complete', {
        messages: [
          { role: 'system', content: '你是大肥鱼的小说工坊内置写作助手。你可以帮用户写章、润色、诊断、查世界书、管理项目等；请用中文简洁回答。' },
          ...history,
        ],
        maxTokens: 2000,
      })
      patch({ chatMessages: [...history, { role: 'assistant', content: result.text }] })
    }, undefined)
  }, [state.chatInput, state.chatMessages, state.chatBusy, run])

  const selectedBook = state.book
  const promptRequest = state.promptRequest
  const alertRequest = state.alertRequest

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><strong>大肥鱼的小说工坊</strong><span className="version">{state.info?.version ?? '…'}</span></div>
        <div className="top-actions">
          <span className="path">{state.workspace?.path ?? '未选择工作区'}</span>
          <button onClick={() => void run(async () => { const path = await call('workspace:choose', undefined); if (path) await refreshWorkspace() })}>选择工作区</button>
          <button onClick={openReader}>本地阅读</button>
          <button onClick={openSettings}>模型设置</button>
        </div>
      </header>

      {state.error && <div className="error-bar">{state.error}</div>}
      {state.notice && <div className="notice-bar">{state.notice}</div>}

      <div className="layout">
        <aside className="sidebar left">
          <div className="sidebar-head">
            <button className={state.view === 'projects' ? 'active' : ''} onClick={() => patch({ view: 'projects' })}>项目</button>
            <button className={state.view === 'lorebook' ? 'active' : ''} onClick={() => patch({ view: 'lorebook' })}>世界书</button>
            <span className="spacer" />
            <button onClick={importFile}>导入</button>
            <button onClick={() => void createProject()}>＋</button>
          </div>

          {state.view === 'lorebook' ? (
            <div className="sidebar-scroll">
              <div className="panel-section">
                <div className="section-title">世界书条目</div>
                {state.lorebook?.entries.map((entry) => (
                  <div className="row" key={entry.id}>
                    <div className="row-main">
                      <strong>{entry.name}</strong>
                      <span className="muted">{entry.keywords.slice(0, 3).join('、')}{entry.always_active ? ' · 常驻' : ''}</span>
                    </div>
                    <div className="row-actions">
                      <button onClick={async () => { const content = await askPrompt('条目内容', entry.content); if (content !== null) saveLoreEntry({ ...entry, content }) }}>改</button>
                      <button onClick={() => deleteLoreEntry(entry.id)}>删</button>
                    </div>
                  </div>
                ))}
                {state.lorebook?.entries.length === 0 && <div className="empty">暂无世界书条目</div>}
                <button
                  className="full-btn"
                  onClick={async () => {
                    const name = await askPrompt('条目名称')
                    const content = await askPrompt('条目内容')
                    if (name && content && state.selectedProjectId) {
                      saveLoreEntry({
                        id: `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, name, content,
                        keywords: [], is_regex: false, case_sensitive: false, always_active: false, enabled: true,
                        priority: 50, scan_depth: 0, inject_target: 'system', inject_position: 'append', insertion_depth: 0,
                        book_id: state.selectedProjectId, volume_id: undefined, tags: [], version: 1,
                        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                      })
                    }
                  }}
                >＋ 新建条目</button>
              </div>
            </div>
          ) : selectedBook ? (
            <div className="sidebar-scroll">
              <div className="panel-section">
                <div className="section-title">{selectedBook.title}</div>
                <div className="muted">{selectedBook.genre} · 阶段 {selectedBook.currentPhase} · {selectedBook.stats.chapterCount} 章 · {selectedBook.stats.totalWords} 字</div>
                <div className="row">
                  <label>章节</label>
                  <select value={state.selectedChapterNo ?? 1} onChange={(e) => selectedBook && loadChapter(selectedBook.id, Number(e.target.value))}>
                    {Array.from({ length: Math.max(1, state.chapters.length + 1) }, (_, i) => i + 1).map((no) => (
                      <option key={no} value={no}>第 {no} 章</option>
                    ))}
                  </select>
                  <button onClick={newChapter}>新建章</button>
                </div>
                <div className="action-grid">
                  <button onClick={() => selectedBook && loadChapter(selectedBook.id, Math.max(1, (state.selectedChapterNo ?? 1) - 1))}>上一章</button>
                  <button onClick={() => selectedBook && loadChapter(selectedBook.id, (state.selectedChapterNo ?? 1) + 1)}>下一章</button>
                  <button onClick={writeChapterAI}>AI 写章</button>
                  <button onClick={polishAI}>一键润色</button>
                  <button onClick={depolishAI}>去 AI 味</button>
                  <button onClick={() => void styleConvertAI()}>文风</button>
                  <button onClick={validateAI}>校验</button>
                  <button onClick={diagnoseAI}>诊断</button>
                  <button onClick={() => void exportAI()}>导出文本</button>
                  <button onClick={() => void exportRich()}>EPUB/PDF/DOCX</button>
                  <button onClick={() => void deleteProject(false)} className="danger">删除书籍</button>
                </div>
              </div>
              <div className="panel-section">
                <div className="section-title">本地库</div>
                {state.library.slice(0, 10).map((item) => (
                  <div className="row" key={item.id}>
                    <div className="row-main"><strong>{item.title}</strong><span className="muted">{item.kind}</span></div>
                    <div className="row-actions">
                      <button onClick={async () => { const content = await askPrompt('内容', item.content); if (content !== null) saveLibraryEntry({ ...item, content }) }}>改</button>
                      <button onClick={() => deleteLibraryEntry(item.id)}>删</button>
                    </div>
                  </div>
                ))}
                <button className="full-btn" onClick={async () => {
                  const kind = await askPrompt('类型（material / skill）', 'material')
                  const title = await askPrompt('标题')
                  const content = await askPrompt('内容')
                  if (kind && title && content && (kind === 'material' || kind === 'skill')) {
                    saveLibraryEntry({ id: `lib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, kind: kind as 'material' | 'skill', title, content, tags: [], bookIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
                  }
                }}>＋ 新增素材/技能</button>
              </div>
            </div>
          ) : (
            <div className="sidebar-scroll">
              <div className="panel-section">
                <div className="section-title">作品库</div>
                {state.projects.map((p) => (
                  <div className="row clickable" key={p.id} onClick={() => openProject(p.id)}>
                    <div className="row-main"><strong>{p.title}</strong><span className="muted">{p.genre} · {p.chapterCount} 章 · {p.totalWords} 字</span></div>
                    <span className="muted">→</span>
                  </div>
                ))}
                {state.projects.length === 0 && <div className="empty">还没有作品，点上方 ＋ 创建</div>}
              </div>
            </div>
          )}
        </aside>

        <main className="editor">
          {state.selectedProjectId ? (
            <>
              <div className="editor-toolbar">
                <input className="chapter-title" value={state.editorTitle} onChange={(e) => patch({ editorTitle: e.target.value })} placeholder="章节标题" />
                <button onClick={() => { undo(); editorRef.current?.focus() }} disabled={state.undoStack.length === 0}>↶</button>
                <button onClick={redo} disabled={state.redoStack.length === 0}>↷</button>
                <button onClick={() => patch({ findOpen: !state.findOpen })}>查找</button>
                <button onClick={() => patch({ fontSize: Math.max(12, state.fontSize - 1) })}>A-</button>
                <button onClick={() => patch({ fontSize: Math.min(28, state.fontSize + 1) })}>A+</button>
                <button onClick={saveChapter} disabled={state.busy || !state.selectedChapterNo}>保存</button>
              </div>
              {state.findOpen && (
                <div className="find-bar">
                  <input value={state.findText} onChange={(e) => patch({ findText: e.target.value })} placeholder="查找" />
                  <button onClick={() => doFindReplace(false)}>查找</button>
                  <input value={state.replaceText} onChange={(e) => patch({ replaceText: e.target.value })} placeholder="替换为" />
                  <button onClick={() => doFindReplace(true)}>全部替换</button>
                  <button onClick={() => patch({ findOpen: false })}>关闭</button>
                </div>
              )}
              <textarea
                ref={editorRef}
                className="chapter-editor"
                value={state.editorText}
                onChange={(e) => patch({ editorText: e.target.value })}
                style={{ fontSize: state.fontSize }}
                placeholder="在此编辑小说正文…"
                spellCheck={false}
              />
            </>
          ) : (
            <div className="welcome">
              <h1>大肥鱼的小说工坊</h1>
              <p>左侧选择一个项目，或点击顶部 ＋ 创建新作品。</p>
            </div>
          )}
        </main>
      </div>

      <footer className="chat-bar">
        <div className="chat-messages">
          {state.chatMessages.map((msg, i) => (
            <div className={`chat-msg ${msg.role}`} key={i}><b>{msg.role === 'user' ? '你' : 'AI'}</b><span>{msg.content}</span></div>
          ))}
          {state.chatMessages.length === 0 && <div className="chat-hint">和 AI 助手对话，可以帮你写章、润色、诊断、管理作品…</div>}
        </div>
        <div className="chat-input-row">
          <input
            value={state.chatInput}
            onChange={(e) => patch({ chatInput: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') sendChat() }}
            placeholder="输入消息，Enter 发送"
          />
          <button onClick={sendChat} disabled={state.chatBusy || !state.chatInput.trim()}>发送</button>
        </div>
      </footer>

      {state.showSettings && (
        <div className="modal-mask" onClick={() => patch({ showSettings: false })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><strong>模型设置</strong><button onClick={() => patch({ showSettings: false })}>关闭</button></div>
            <div className="modal-body">
              {state.models.map((m) => (
                <div className="model-item" key={m.id}>
                  <div><strong>{m.name}</strong> <span className="muted">{m.provider} · {m.model}</span></div>
                  <span>
                    <button onClick={() => patch({ modelDraft: m })}>编辑</button>
                    <button onClick={() => testModel(m.id)}>测试</button>
                    <button onClick={() => deleteModel(m.id)}>删除</button>
                  </span>
                </div>
              ))}
              {state.models.length === 0 && <div className="empty">还没有模型，添加一个即可开始 AI 创作</div>}
              <div className="model-form">
                <h4>{state.modelDraft.id ? '编辑模型' : '新增模型'}</h4>
                <label>名称<input value={state.modelDraft.name} onChange={(e) => patch({ modelDraft: { ...state.modelDraft, name: e.target.value } })} /></label>
                <label>Provider
                  <select value={state.modelDraft.provider} onChange={(e) => patch({ modelDraft: { ...state.modelDraft, provider: e.target.value as ModelProfile['provider'] } })}>
                    <option value="custom">OpenAI 兼容（自定义）</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google Gemini</option>
                  </select>
                </label>
                <label>Base URL<input value={state.modelDraft.baseUrl ?? ''} onChange={(e) => patch({ modelDraft: { ...state.modelDraft, baseUrl: e.target.value } })} /></label>
                <label>API Key<input type="password" value={state.modelDraft.apiKey ?? ''} onChange={(e) => patch({ modelDraft: { ...state.modelDraft, apiKey: e.target.value } })} /></label>
                <label>模型名<input value={state.modelDraft.model} onChange={(e) => patch({ modelDraft: { ...state.modelDraft, model: e.target.value } })} /></label>
                <button onClick={() => { const draft = { ...state.modelDraft, id: state.modelDraft.id || `model_${Date.now().toString(36)}` }; saveModel(draft) }} disabled={state.busy || !state.modelDraft.name.trim() || !state.modelDraft.model.trim()}>保存模型</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {state.reader && (
        <div className="modal-mask" onClick={() => patch({ reader: null })}>
          <div className="modal reader-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><strong>本地阅读 · {state.reader.path.split(/[\\/]/).at(-1)}</strong><button onClick={() => patch({ reader: null })}>关闭</button></div>
            <div className="modal-body reader-body">
              {state.reader.text !== null ? <pre>{state.reader.text}</pre> : <p>该格式已交给系统默认程序打开（PDF/EPUB）。</p>}
            </div>
          </div>
        </div>
      )}

      {promptRequest && (
        <PromptModal title={promptRequest.title} defaultValue={promptRequest.defaultValue}
          onConfirm={(value) => { promptRequest.resolve(value); patch({ promptRequest: null }) }}
          onCancel={() => { promptRequest.resolve(null); patch({ promptRequest: null }) }} />
      )}
      {alertRequest && (
        <AlertModal title={alertRequest.title} message={alertRequest.message}
          onClose={() => { alertRequest.resolve(); patch({ alertRequest: null }) }} />
      )}
    </div>
  )
}

function PromptModal(props: { title: string; defaultValue: string; onConfirm: (value: string) => void; onCancel: () => void }): JSX.Element {
  const [value, setValue] = useState(props.defaultValue)
  return (
    <div className="modal-mask" onClick={props.onCancel}>
      <div className="modal prompt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><strong>{props.title}</strong><button onClick={props.onCancel}>取消</button></div>
        <div className="modal-body">
          <input className="prompt-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') props.onConfirm(value); if (e.key === 'Escape') props.onCancel() }} />
          <div className="modal-actions"><button onClick={() => props.onConfirm(value)}>确定</button></div>
        </div>
      </div>
    </div>
  )
}

function AlertModal(props: { title: string; message: string; onClose: () => void }): JSX.Element {
  return (
    <div className="modal-mask" onClick={props.onClose}>
      <div className="modal alert-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><strong>{props.title}</strong><button onClick={props.onClose}>关闭</button></div>
        <div className="modal-body alert-body"><pre>{props.message}</pre></div>
        <div className="modal-actions"><button onClick={props.onClose}>确定</button></div>
      </div>
    </div>
  )
}