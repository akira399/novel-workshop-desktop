import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppInfo, AppSettings, ChapterWithText, LibraryEntry, LorebookSnapshot, ModelProfile, WorkspaceInfo } from '@dafuyu/contracts'
import type { BookSummary } from '@dafuyu/core/novel'
import type { LoreEntry } from '@dafuyu/core/types'

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
  notice: string | null
  busy: boolean
  showSettings: boolean
  models: ModelProfile[]
  modelDraft: ModelProfile
  reader: { path: string; ext: string; text: string | null } | null
  library: LibraryEntry[]
  promptRequest: { title: string; defaultValue: string; resolve: (value: string | null) => void } | null
  alertRequest: { title: string; message: string; resolve: () => void } | null
}

const emptyModel: ModelProfile = {
  id: '',
  name: '',
  provider: 'custom',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.8,
  maxTokens: 4096,
  enabled: true,
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
  notice: null,
  busy: false,
  showSettings: false,
  models: [],
  modelDraft: emptyModel,
  reader: null,
  library: [],
  promptRequest: null,
  alertRequest: null,
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
      call('app:getInfo', undefined),
      call('workspace:get', undefined),
      call('settings:get', undefined),
      call('projects:list', undefined),
      call('library:list', {}),
    ])
    patch({ info, workspace, settings, projects, library })
  }, [patch])

  useEffect(() => {
    void run(refreshWorkspace)
  }, [run, refreshWorkspace])

  const loadModels = useCallback(async () => {
    const models = await call('models:list', undefined)
    patch({ models })
  }, [patch])

  const loadLibrary = useCallback(async () => {
    const library = await call('library:list', {})
    patch({ library })
  }, [patch])

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
    }, '章节已保存')
  }, [run, state])

  const newChapter = useCallback(() => {
    if (!state.selectedProjectId) return
    const next = state.chapters.length > 0 ? Math.max(...state.chapters.map((c) => c.no)) + 1 : 1
    patch({ selectedChapterNo: next, chapter: null, editorText: '', editorTitle: `第 ${next} 章` })
  }, [state.selectedProjectId, state.chapters, patch])

  // ── AI 动作 ──

  const writeChapterAI = useCallback(() => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo) return
    void run(async () => {
      const result = await call('agent:writeChapter', { projectId, chapterNo })
      patch({ editorText: result.text })
    }, 'AI 已生成章节')
  }, [run, state.selectedProjectId, state.selectedChapterNo, patch])

  const polishAI = useCallback(() => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo) return
    void run(async () => {
      const result = await call('agent:polish', { projectId, chapterNo, text: state.editorText })
      patch({ editorText: result.polished })
    }, '润色完成')
  }, [run, state, patch])

  const depolishAI = useCallback(() => {
    void run(async () => {
      const result = await call('agent:depolish', { text: state.editorText })
      patch({ editorText: result.text })
    }, '去 AI 味完成')
  }, [run, state.editorText, patch])

  const styleConvertAI = useCallback(async () => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo) return
    const styleId = await askPrompt('文风模板 id（如 style-xuanhuan / style-urban / style-scifi）', 'style-xuanhuan')
    if (!styleId) return
    await run(async () => {
      const result = await call('agent:styleConvert', { projectId, chapterNo, styleId })
      patch({ editorText: result.revised })
    }, '文风转换完成')
  }, [run, state.selectedProjectId, state.selectedChapterNo, patch])

  const validateAI = useCallback(() => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo) return
    void run(async () => {
      const report = await call('chapters:validate', { projectId, chapterNo, title: state.editorTitle, text: state.editorText })
      const summary = report.issues.map((i) => `[${i.level}] ${i.message}`).join('\n') || '校验通过，无问题'
      await showAlert(`校验结果：${report.passed ? '通过' : '未通过'}\n\n${summary}`)
    })
  }, [run, state])

  const diagnoseAI = useCallback(() => {
    const projectId = state.selectedProjectId
    if (!projectId) return
    const start = state.selectedChapterNo ?? 1
    void run(async () => {
      const report = await call('chapters:diagnose', { projectId, chapterStart: start, count: 3 })
      await showAlert(`黄金三章诊断：${report.score}/100\n\n${report.issues.slice(0, 10).map((i) => `[${i.severity}] ${i.advice}`).join('\n')}`)
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
  }, [run, state.selectedProjectId])

  const exportRich = useCallback(async () => {
    const projectId = state.selectedProjectId
    if (!projectId) return
    const format = await askPrompt('导出格式（epub / pdf / docx）', 'epub')
    if (!format || !['epub', 'pdf', 'docx'].includes(format)) return
    await run(async () => {
      const result = await call('export:file', { projectId, format: format as 'epub' | 'pdf' | 'docx' })
      if (result.path) await showAlert(`已导出到：${result.path}`)
    })
  }, [run, state.selectedProjectId])

  const importText = useCallback(() => {
    void run(async () => {
      const text = await askPrompt('粘贴要导入的 txt/md 全文（可含章节标题）')
      if (!text) return
      const result = await call('projects:importText', { text, fileName: 'import.txt' })
      await showAlert(`导入完成：${result.title}，共 ${result.chapterCount} 章，${result.totalWords} 字`)
      await refreshWorkspace()
      await loadProject(result.bookId)
    })
  }, [run, refreshWorkspace, loadProject])

  const openReader = useCallback(() => {
    void run(async () => {
      const result = await call('reader:open', undefined)
      if (!result.path) return
      if (result.openedExternal) {
        await showAlert(`已用系统默认程序打开：${result.path}`)
        return
      }
      patch({ reader: { path: result.path, ext: result.ext, text: result.text } })
    })
  }, [run, patch])

  const saveLibraryEntry = useCallback((entry: LibraryEntry) => {
    void run(async () => {
      await call('library:save', { entry })
      const library = await call('library:list', {})
      patch({ library })
    })
  }, [run, patch])

  const deleteLibraryEntry = useCallback((id: string) => {
    void run(async () => {
      await call('library:delete', { id })
      const library = await call('library:list', {})
      patch({ library })
    })
  }, [run, patch])

  // ── 世界书 ──

  const saveLoreEntry = useCallback((entry: LoreEntry) => {
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

  // ── 模型设置 ──

  const openSettings = useCallback(() => {
    patch({ showSettings: true })
    void loadModels()
  }, [patch, loadModels])

  const saveModel = useCallback((profile: ModelProfile) => {
    void run(async () => {
      const saved = await call('models:save', { profile })
      const models = await call('models:list', undefined)
      patch({ models, modelDraft: emptyModel })
      await showAlert(`模型「${saved.name}」已保存`)
    })
  }, [run, patch])

  const deleteModel = useCallback((id: string) => {
    void run(async () => {
      await call('models:delete', { id })
      const models = await call('models:list', undefined)
      patch({ models })
    })
  }, [run, patch])

  const testModel = useCallback((id: string) => {
    void run(async () => {
      const result = await call('models:test', { id })
      await showAlert(result.message)
    })
  }, [run])

  const selectedBook = useMemo(() => state.projects.find((p) => p.id === state.selectedProjectId) ?? null, [state.projects, state.selectedProjectId])
  const promptRequest = state.promptRequest
  const alertRequest = state.alertRequest

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
          <button onClick={openSettings} disabled={state.busy}>模型设置</button>
          <button onClick={openReader} disabled={state.busy}>本地阅读</button>
        </div>
      </header>

      {state.error && <div className="error-bar">{state.error}</div>}
      {state.notice && <div className="notice-bar">{state.notice}</div>}

      <div className="layout">
        <aside className="sidebar left">
          <div className="panel-title">
            作品库
            <span>
              <button onClick={async () => {
                const title = await askPrompt('新作品标题')
                const genre = await askPrompt('题材 id（如 fantasy/xianxia/urban）', 'fantasy')
                if (title && genre) createProject(title, genre)
              }}>＋</button>
              <button onClick={importText}>导入</button>
            </span>
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
                <button onClick={writeChapterAI} disabled={state.busy || !state.selectedChapterNo}>AI 写章</button>
                <button onClick={polishAI} disabled={state.busy || !state.selectedChapterNo}>润色</button>
                <button onClick={depolishAI} disabled={state.busy || !state.editorText}>去 AI 味</button>
                <button onClick={styleConvertAI} disabled={state.busy || !state.selectedChapterNo}>文风</button>
                <button onClick={validateAI} disabled={state.busy || !state.selectedChapterNo}>校验</button>
                <button onClick={diagnoseAI} disabled={state.busy || !state.selectedProjectId}>诊断</button>
                <button onClick={exportAI} disabled={state.busy || !state.selectedProjectId}>导出文本</button>
                <button onClick={exportRich} disabled={state.busy || !state.selectedProjectId}>导出 EPUB/PDF/DOCX</button>
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
          <div className="panel-title">
            本地库
            <button onClick={async () => {
              const kind = await askPrompt('类型（material / skill）', 'material')
              const title = await askPrompt('标题')
              const content = await askPrompt('内容')
              if (kind && title && content && (kind === 'material' || kind === 'skill')) {
                saveLibraryEntry({
                  id: `lib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                  kind,
                  title,
                  content,
                  tags: [],
                  bookIds: [],
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                })
              }
            }}>＋</button>
          </div>
          <div className="lorebook-list">
            {state.library.slice(0, 20).map((entry) => (
              <div className="lore-entry" key={entry.id}>
                <div className="lore-entry-head">
                  <strong>{entry.title}</strong>
                  <span>
                    <button onClick={async () => {
                      const content = await askPrompt('内容', entry.content)
                      if (content !== null) saveLibraryEntry({ ...entry, content })
                    }}>改</button>
                    <button onClick={() => deleteLibraryEntry(entry.id)}>删</button>
                  </span>
                </div>
                <p>{entry.content.slice(0, 80)}</p>
              </div>
            ))}
            {state.library.length === 0 && <div className="empty">暂无素材/技能</div>}
          </div>
          <div className="panel-title">世界书</div>
          {state.lorebook ? (
            <div className="lorebook-list">
              {state.lorebook.entries.map((entry) => (
                <div className="lore-entry" key={entry.id}>
                  <div className="lore-entry-head">
                    <strong>{entry.name}</strong>
                    <span>
                      <button onClick={async () => {
                        const content = await askPrompt('条目内容', entry.content)
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
                onClick={async () => {
                  const name = await askPrompt('条目名称')
                  const content = await askPrompt('条目内容')
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

      {state.showSettings && (
        <div className="modal-mask" onClick={() => patch({ showSettings: false })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>模型设置</strong>
              <button onClick={() => patch({ showSettings: false })}>关闭</button>
            </div>
            <div className="modal-body">
              <div className="model-list">
                {state.models.map((m) => (
                  <div className="model-item" key={m.id}>
                    <div>
                      <strong>{m.name}</strong> <span className="muted">{m.provider} · {m.model}</span>
                    </div>
                    <span>
                      <button onClick={() => patch({ modelDraft: m })}>编辑</button>
                      <button onClick={() => testModel(m.id)}>测试</button>
                      <button onClick={() => deleteModel(m.id)}>删除</button>
                    </span>
                  </div>
                ))}
                {state.models.length === 0 && <div className="empty">还没有模型，添加一个即可开始 AI 创作</div>}
              </div>

              <div className="model-form">
                <h4>{state.modelDraft.id ? '编辑模型' : '新增模型'}</h4>
                <label>名称
                  <input value={state.modelDraft.name} onChange={(e) => patch({ modelDraft: { ...state.modelDraft, name: e.target.value } })} placeholder="如 我的 DeepSeek" />
                </label>
                <label>Provider
                  <select value={state.modelDraft.provider} onChange={(e) => patch({ modelDraft: { ...state.modelDraft, provider: e.target.value as ModelProfile['provider'] } })}>
                    <option value="custom">OpenAI 兼容（自定义）</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google Gemini</option>
                  </select>
                </label>
                <label>Base URL（可选）
                  <input value={state.modelDraft.baseUrl ?? ''} onChange={(e) => patch({ modelDraft: { ...state.modelDraft, baseUrl: e.target.value } })} placeholder="https://api.deepseek.com/v1" />
                </label>
                <label>API Key
                  <input type="password" value={state.modelDraft.apiKey ?? ''} onChange={(e) => patch({ modelDraft: { ...state.modelDraft, apiKey: e.target.value } })} placeholder="sk-..." />
                </label>
                <label>模型名
                  <input value={state.modelDraft.model} onChange={(e) => patch({ modelDraft: { ...state.modelDraft, model: e.target.value } })} placeholder="deepseek-chat / gpt-4o / claude-3-5-sonnet" />
                </label>
                <button
                  onClick={() => {
                    const draft = { ...state.modelDraft, id: state.modelDraft.id || `model_${Date.now().toString(36)}` }
                    saveModel(draft)
                  }}
                  disabled={state.busy || !draftName(state.modelDraft)}
                >
                  保存模型
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {state.reader && (
        <div className="modal-mask" onClick={() => patch({ reader: null })}>
          <div className="modal reader-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>本地阅读 · {state.reader.path.split(/[\\/]/).at(-1)}</strong>
              <button onClick={() => patch({ reader: null })}>关闭</button>
            </div>
            <div className="modal-body reader-body">
              {state.reader.text !== null ? (
                <pre>{state.reader.text}</pre>
              ) : (
                <p>该格式已交给系统默认程序打开（PDF/EPUB）。</p>
              )}
            </div>
          </div>
        </div>
      )}

      {promptRequest && (
        <PromptModal
          title={promptRequest.title}
          defaultValue={promptRequest.defaultValue}
          onConfirm={(value) => {
            promptRequest.resolve(value)
            patch({ promptRequest: null })
          }}
          onCancel={() => {
            promptRequest.resolve(null)
            patch({ promptRequest: null })
          }}
        />
      )}

      {alertRequest && (
        <AlertModal
          title={alertRequest.title}
          message={alertRequest.message}
          onClose={() => {
            alertRequest.resolve()
            patch({ alertRequest: null })
          }}
        />
      )}
    </div>
  )
}

function PromptModal(props: { title: string; defaultValue: string; onConfirm: (value: string) => void; onCancel: () => void }): JSX.Element {
  const [value, setValue] = useState(props.defaultValue)
  return (
    <div className="modal-mask" onClick={props.onCancel}>
      <div className="modal prompt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{props.title}</strong>
          <button onClick={props.onCancel}>取消</button>
        </div>
        <div className="modal-body">
          <input
            className="prompt-input"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onConfirm(value)
              if (e.key === 'Escape') props.onCancel()
            }}
          />
          <div className="modal-actions">
            <button onClick={() => props.onConfirm(value)}>确定</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AlertModal(props: { title: string; message: string; onClose: () => void }): JSX.Element {
  return (
    <div className="modal-mask" onClick={props.onClose}>
      <div className="modal alert-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{props.title}</strong>
          <button onClick={props.onClose}>关闭</button>
        </div>
        <div className="modal-body alert-body">
          <pre>{props.message}</pre>
        </div>
        <div className="modal-actions">
          <button onClick={props.onClose}>确定</button>
        </div>
      </div>
    </div>
  )
}

function draftName(profile: ModelProfile): boolean {
  return profile.name.trim().length > 0 && profile.model.trim().length > 0
}
