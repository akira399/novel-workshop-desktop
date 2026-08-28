import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo, AppSettings, ChapterWithText, LibraryEntry, LorebookSnapshot, ModelProfile, WorkspaceInfo } from '@dafuyu/contracts'
import type { BookSummary } from '@dafuyu/core/novel'
import type { LoreEntry } from '@dafuyu/core/types'
import { splitPolishSuggestions, applyPolishSuggestions } from '@dafuyu/core/polish'
import type { PolishSuggestion } from '@dafuyu/core/polish'

const GENRES = [
  ['fantasy', '玄幻'], ['xianxia', '仙侠'], ['wuxia', '武侠'], ['urban', '都市'], ['scifi', '科幻'],
  ['mystery', '悬疑'], ['horror', '惊悚'], ['romance', '言情'], ['ancient-romance', '古言'], ['game', '游戏'],
  ['light-novel', '轻小说'], ['history', '历史'], ['military', '军事'], ['business', '商战'], ['strategy', '权谋'],
] as const

const PROVIDER_PRESETS: Array<{ id: ModelProfile['provider']; label: string; baseUrl: string }> = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { id: 'moonshot', label: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'ollama', label: 'Ollama（本地）', baseUrl: 'http://127.0.0.1:11434/v1' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'custom', label: '自定义提供商（OpenAI 兼容）', baseUrl: '' },
]

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
  remoteModels: string[]
  fetchingModels: boolean
  chatMessages: ChatMessage[]
  chatInput: string
  chatBusy: boolean
  activeModelId: string | null
  batchProvider: ModelProfile['provider']
  batchBaseUrl: string
  batchApiKey: string
  batchModelNames: string
  selectedRemoteModels: string[]
  promptRequest: PromptRequest | null
  alertRequest: AlertRequest | null
  polishPreview: { original: string; polished: string; suggestions: PolishSuggestion[] } | null
  generating: 'write' | 'polish' | null
  loreEditor: { mode: 'new' | 'edit'; entry?: LoreEntry } | null
  error: string | null
  notice: string | null
  busy: boolean
}

const initialUi: UiState = {
  info: null, workspace: null, settings: {}, projects: [], selectedProjectId: null, book: null,
  chapters: [], selectedChapterNo: null, chapter: null, editorText: '', editorTitle: '',
  undoStack: [], redoStack: [], findOpen: false, findText: '', replaceText: '', fontSize: 16,
  view: 'projects', lorebook: null, library: [], models: [], modelDraft: emptyModel,
  showSettings: false, reader: null, remoteModels: [], fetchingModels: false, chatMessages: [], chatInput: '', chatBusy: false, activeModelId: null,
  batchProvider: 'deepseek', batchBaseUrl: 'https://api.deepseek.com', batchApiKey: '', batchModelNames: '', selectedRemoteModels: [],
  promptRequest: null, alertRequest: null, polishPreview: null, generating: null, loreEditor: null, error: null, notice: null, busy: false,
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

  const patch = useCallback((part: Partial<UiState> | ((prev: UiState) => Partial<UiState>)) => {
    setState((prev) => ({ ...prev, ...(typeof part === 'function' ? part(prev) : part) }))
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
      call('app:getInfo', undefined), call('workspace:get', undefined), call('settings:get', undefined),
      call('projects:list', undefined), call('library:list', {}),
    ])
    patch({ info, workspace, settings, projects, library })
  }, [patch])

  useEffect(() => { void run(refreshWorkspace) }, [run, refreshWorkspace])

  const loadModels = useCallback(async () => {
    const models = await call('models:list', undefined)
    patch((prev) => ({
      models,
      activeModelId: prev.activeModelId && models.some((m) => m.id === prev.activeModelId)
        ? prev.activeModelId
        : models[0]?.id ?? null,
    }))
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
      void showAlert(`已导入《${result.title}》：${result.chapterCount} 章 / ${result.totalWords} 字`)
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
    if (!projectId) return
    const chapterNo = state.selectedChapterNo ?? 1
    patch({ generating: 'write' })
    void run(async () => {
      try {
        const result = await call('agent:writeChapter', { projectId, chapterNo, profileId: state.activeModelId ?? undefined })
        setEditorText(result.text)
        patch({
          selectedChapterNo: chapterNo,
          chapter: state.chapter && state.chapter.chapter.no === chapterNo ? state.chapter : null,
          editorTitle: state.editorTitle || `第 ${chapterNo} 章`,
        })
      } catch (error) {
        void showAlert(error instanceof Error ? error.message : String(error), 'AI 写章失败')
        throw error
      } finally {
        patch({ generating: null })
      }
    }, 'AI 已生成章节')
  }, [run, state.selectedProjectId, state.selectedChapterNo, setEditorText, patch, state.activeModelId, showAlert])

  const polishAI = useCallback(() => {
    const projectId = state.selectedProjectId
    if (!projectId) return
    const chapterNo = state.selectedChapterNo
    if (!chapterNo) {
      void showAlert('请先选择或打开一个章节后再润色', '提示')
      return
    }
    const text = state.editorText
    if (!text.trim()) {
      void showAlert('当前章节没有可润色的正文', '提示')
      return
    }
    patch({ generating: 'polish' })
    void run(async () => {
      try {
        const result = await call('agent:polish', { projectId, chapterNo, text, profileId: state.activeModelId ?? undefined })
        const suggestions = splitPolishSuggestions(text, result.polished)
        setEditorText(result.polished)
        patch({ polishPreview: { original: text, polished: result.polished, suggestions } })
      } catch (error) {
        void showAlert(error instanceof Error ? error.message : String(error), '一键润色失败')
        throw error
      } finally {
        patch({ generating: null })
      }
    }, '润色完成，可逐条采纳')
  }, [run, state.selectedProjectId, state.selectedChapterNo, state.editorText, setEditorText, patch, state.activeModelId, showAlert])

  const togglePolish = useCallback((id: string) => {
    setState((prev) => {
      if (!prev.polishPreview) return prev
      const suggestions = prev.polishPreview.suggestions.map((s) => (s.id === id ? { ...s, accepted: !s.accepted } : s))
      return { ...prev, polishPreview: { ...prev.polishPreview, suggestions } }
    })
  }, [])

  const acceptAllPolish = useCallback(() => {
    setState((prev) => {
      if (!prev.polishPreview) return prev
      const suggestions = prev.polishPreview.suggestions.map((s) => (s.polished.length > 0 ? { ...s, accepted: true } : s))
      return { ...prev, polishPreview: { ...prev.polishPreview, suggestions } }
    })
  }, [])

  const rejectAllPolish = useCallback(() => {
    setState((prev) => {
      if (!prev.polishPreview) return prev
      const suggestions = prev.polishPreview.suggestions.map((s) => ({ ...s, accepted: false }))
      return { ...prev, polishPreview: { ...prev.polishPreview, suggestions }, editorText: prev.polishPreview.original }
    })
  }, [])

  const discardPolish = useCallback(() => {
    setState((prev) => {
      if (!prev.polishPreview) return prev
      return { ...prev, polishPreview: null, editorText: prev.polishPreview.original }
    })
  }, [])

  const savePolish = useCallback(() => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo || !state.polishPreview) return
    const preview = state.polishPreview
    void run(async () => {
      const text = applyPolishSuggestions(preview.original, preview.suggestions)
      const saved = await call('chapters:save', { projectId, chapterNo, title: state.editorTitle, text })
      patch({ chapter: state.chapter ? { ...state.chapter, chapter: saved } : state.chapter, polishPreview: null, undoStack: [], redoStack: [] })
      const chapters = await call('chapters:list', { projectId })
      patch({ chapters })
    }, '润色结果已保存（仅采纳的改动）')
  }, [run, state])

  const depolishAI = useCallback(() => {
    void run(async () => {
      const result = await call('agent:depolish', { text: state.editorText, profileId: state.activeModelId ?? undefined })
      setEditorText(result.text)
    }, '去 AI 味完成')
  }, [run, state.editorText, setEditorText, state.activeModelId])

  const styleConvertAI = useCallback(async () => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo) return
    const styleId = await askPrompt('文风模板 id（如 style-xuanhuan / style-urban / style-scifi）', 'style-xuanhuan')
    if (!styleId) return
    await run(async () => {
      const result = await call('agent:styleConvert', { projectId, chapterNo, styleId, profileId: state.activeModelId ?? undefined })
      setEditorText(result.revised)
    }, '文风转换完成')
  }, [run, askPrompt, state.selectedProjectId, state.selectedChapterNo, setEditorText, state.activeModelId])

  const validateAI = useCallback(() => {
    const projectId = state.selectedProjectId
    const chapterNo = state.selectedChapterNo
    if (!projectId || !chapterNo) return
    const editorTitle = state.editorTitle
    const editorText = state.editorText
    void run(async () => {
      const report = await call('chapters:validate', { projectId, chapterNo, title: editorTitle, text: editorText })
      const summary = report.issues.map((i) => `[${i.level}] ${i.message}`).join('\n') || '校验通过，无问题'
      void showAlert(summary, `校验结果：${report.passed ? '通过' : '未通过'}`)
    })
  }, [run, state.selectedProjectId, state.selectedChapterNo, state.editorTitle, state.editorText])

  const diagnoseAI = useCallback(() => {
    const projectId = state.selectedProjectId
    if (!projectId) return
    const chapterStart = state.selectedChapterNo ?? 1
    void run(async () => {
      const report = await call('chapters:diagnose', { projectId, chapterStart, count: 3 })
      void showAlert(report.issues.slice(0, 10).map((i) => `[${i.severity}] ${i.advice}`).join('\n'), `黄金三章诊断：${report.score}/100`)
    })
  }, [run, state.selectedProjectId, state.selectedChapterNo])

  const exportAI = useCallback(async () => {
    const projectId = state.selectedProjectId
    if (!projectId) return
    const format = await askPrompt('导出格式（txt / markdown / platform）', 'markdown')
    if (!format || !['txt', 'markdown', 'platform'].includes(format)) return
    await run(async () => {
      const result = await call('chapters:exportToFile', { projectId, format: format as 'txt' | 'markdown' | 'platform' })
      if (result.path) void showAlert(`已导出到：${result.path}`)
    })
  }, [run, askPrompt, state.selectedProjectId, showAlert])

  const exportRich = useCallback(async () => {
    const projectId = state.selectedProjectId
    if (!projectId) return
    const format = await askPrompt('导出格式（epub / pdf / docx）', 'epub')
    if (!format || !['epub', 'pdf', 'docx'].includes(format)) return
    await run(async () => {
      const result = await call('export:file', { projectId, format: format as 'epub' | 'pdf' | 'docx' })
      if (result.path) void showAlert(`已导出到：${result.path}`)
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
      patch((prev) => ({ models, modelDraft: emptyModel, activeModelId: prev.activeModelId ?? saved.id }))
      void showAlert(`模型「${saved.name}」已保存`)
    })
  }, [run, showAlert])
  const deleteModel = useCallback((id: string) => {
    void run(async () => { await call('models:delete', { id }); const models = await call('models:list', undefined); patch((prev) => ({ models, activeModelId: prev.activeModelId === id ? models[0]?.id ?? null : prev.activeModelId })) })
  }, [run])
  const testModel = useCallback((id: string) => {
    void run(async () => { const result = await call('models:test', { id }); void showAlert(result.message) })
  }, [run, showAlert])

  const fetchRemoteModels = useCallback(() => {
    const provider = state.batchProvider
    if (!provider) return
    patch({ fetchingModels: true, remoteModels: [], selectedRemoteModels: [] })
    void run(async () => {
      const result = await call('models:fetch', { provider, baseUrl: state.batchBaseUrl, apiKey: state.batchApiKey })
      patch({ remoteModels: result.models, fetchingModels: false })
      if (result.error) void showAlert(result.error, '获取模型列表失败')
      else void showAlert(`获取到 ${result.models.length} 个模型，按住 Ctrl/Shift 可多选。`, '模型列表')
    })
  }, [run, state.batchProvider, state.batchBaseUrl, state.batchApiKey, showAlert])

  const saveBatchModels = useCallback(() => {
    const manual = state.batchModelNames.split(/[\n,，]/).map((s) => s.trim()).filter(Boolean)
    const names = Array.from(new Set([...state.selectedRemoteModels, ...manual]))
    if (names.length === 0) return
    const providerLabel = PROVIDER_PRESETS.find((p) => p.id === state.batchProvider)?.label ?? state.batchProvider
    void run(async () => {
      let firstId: string | null = null
      for (const model of names) {
        const profile: ModelProfile = {
          id: `model_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name: `${providerLabel} · ${model}`,
          provider: state.batchProvider,
          baseUrl: state.batchBaseUrl,
          apiKey: state.batchApiKey,
          model,
          temperature: 0.8,
          maxTokens: 4096,
          enabled: true,
        }
        await call('models:save', { profile })
        if (!firstId) firstId = profile.id
      }
      const models = await call('models:list', undefined)
      patch((prev) => ({ models, modelDraft: emptyModel, batchModelNames: '', selectedRemoteModels: [], activeModelId: prev.activeModelId ?? firstId }))
      void showAlert(`已保存 ${names.length} 个模型`, '模型添加完成')
    })
  }, [run, state.batchProvider, state.batchBaseUrl, state.batchApiKey, state.batchModelNames, state.selectedRemoteModels, showAlert])

  const openReader = useCallback(() => {
    void run(async () => {
      const result = await call('reader:open', undefined)
      if (!result.path) return
      if (result.openedExternal) { void showAlert(`已用系统默认程序打开：${result.path}`); return }
      patch({ reader: { path: result.path, ext: result.ext, text: result.text } })
    })
  }, [run, showAlert])

  const sendChat = useCallback(() => {
    const text = state.chatInput.trim()
    if (!text || state.chatBusy) return
    const history: ChatMessage[] = [...state.chatMessages, { role: 'user', content: text }]
    const profileId = state.activeModelId ?? undefined
    patch({ chatMessages: history, chatInput: '', chatBusy: true })
    void run(async () => {
      try {
        const result = await call('agent:complete', {
          profileId,
          messages: [
            { role: 'system', content: '你是大肥鱼的小说工坊内置写作助手。你可以帮用户写章、润色、诊断、查世界书、管理项目等；请用中文简洁回答。' },
            ...history,
          ],
          maxTokens: 2000,
        })
        patch({ chatMessages: [...history, { role: 'assistant', content: result.text }] })
      } finally {
        patch({ chatBusy: false })
      }
    }, undefined)
  }, [state.chatInput, state.chatMessages, state.chatBusy, state.activeModelId, run])

  const selectedBook = state.book
  const promptRequest = state.promptRequest
  const alertRequest = state.alertRequest

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>大肥鱼的小说工坊</strong>
          {state.info?.version && <span className="version">{state.info.version}</span>}
        </div>
        <div className="topbar-drag" />
        <div className="top-actions">
          <span className="path">{state.workspace?.path ?? '未选择工作区'}</span>
          <button onClick={() => void run(async () => { const path = await call('workspace:choose', undefined); if (path) await refreshWorkspace() })}>选择工作区</button>
          <button onClick={openReader}>本地阅读</button>
          <button onClick={openSettings}>模型设置</button>
        </div>
        <div className="window-controls">
          <button className="win-btn" onClick={() => window.novelWorkshop.minimize()} title="最小化">─</button>
          <button className="win-btn" onClick={() => window.novelWorkshop.maximize()} title="最大化">□</button>
          <button className="win-btn win-close" onClick={() => window.novelWorkshop.close()} title="关闭">✕</button>
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
            <button onClick={() => void run(async () => { const r = await call('projects:importDemo', undefined); void showAlert(`示例《青云问道》已导入（${r.imported} 条世界书）`); await refreshWorkspace(); await loadProject(r.bookId) })}>示例</button>
            <button onClick={importFile}>导入</button>
            <button onClick={() => void createProject()}>＋</button>
          </div>

          {state.view === 'lorebook' ? (
            <div className="sidebar-scroll">
              <div className="panel-section">
                <div className="section-title">AI 设定生成</div>
                <div className="action-grid">
                  <button disabled={!state.selectedProjectId} onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const result = await call('lorebook:autogen', { bookId: state.selectedProjectId, profileId: state.activeModelId ?? undefined })
                    void showAlert(`已生成 ${result.imported} 条：${result.names.join('、')}`, 'AI 一键生成设定')
                    await loadLorebook(state.selectedProjectId)
                  })}>AI 一键生成设定</button>
                  <button onClick={() => void run(async () => {
                    const genre = await askPrompt('题材（如玄幻/仙侠/都市）', '玄幻')
                    const topic = await askPrompt('选题方向（可留空）', '')
                    if (genre) { const result = await call('agent:marketResearch', { genre, topic: topic ?? undefined, profileId: state.activeModelId ?? undefined }); void showAlert(result.report, '市场调研报告') }
                  })}>市场调研</button>
                </div>
              </div>
              <div className="panel-section">
                <div className="section-title">世界书分组</div>
                {state.lorebook?.groups.map((g) => (
                  <div className="row" key={g.id}>
                    <div className="row-main">
                      <strong>{g.name}</strong>
                      <span className="muted">{g.entry_ids.length} 条 · {g.enabled ? '启用' : '停用'}</span>
                    </div>
                    <div className="row-actions">
                      <button onClick={async () => { const name = await askPrompt('新分组名', g.name); if (name) { await call('lorebook:updateGroup', { id: g.id, name }); await loadLorebook(state.selectedProjectId ?? undefined) } }}>改名</button>
                      <button onClick={() => void run(async () => { await call('lorebook:updateGroup', { id: g.id, enabled: !g.enabled }); await loadLorebook(state.selectedProjectId ?? undefined) })}>{g.enabled ? '停用' : '启用'}</button>
                      <button onClick={async () => { const confirm = await askPrompt('删除分组？输入 yes 确认'); if (confirm === 'yes') { await call('lorebook:deleteGroup', { id: g.id }); await loadLorebook(state.selectedProjectId ?? undefined) } }}>删</button>
                    </div>
                  </div>
                ))}
                {state.lorebook?.groups.length === 0 && <div className="empty">暂无分组</div>}
                <button className="full-btn" onClick={async () => {
                  const name = await askPrompt('新分组名称')
                  if (name) { await call('lorebook:createGroup', { name }); await loadLorebook(state.selectedProjectId ?? undefined) }
                }}>＋ 新建分组</button>
              </div>
              <div className="panel-section">
                <div className="section-title">世界书条目</div>
                {state.lorebook?.entries.map((entry) => (
                  <div className="row" key={entry.id}>
                    <div className="row-main">
                      <strong>{entry.name}</strong>
                      <span className="muted">{entry.keywords.slice(0, 3).join('、')}{entry.always_active ? ' · 常驻' : ''}</span>
                    </div>
                    <div className="row-actions">
                      <button onClick={() => patch({ loreEditor: { mode: 'edit', entry } })}>改</button>
                      <button onClick={() => deleteLoreEntry(entry.id)}>删</button>
                    </div>
                  </div>
                ))}
                {state.lorebook?.entries.length === 0 && <div className="empty">暂无世界书条目</div>}
                <button
                  className="full-btn"
                  onClick={() => patch({ loreEditor: { mode: 'new' } })}
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
                  <button onClick={writeChapterAI} disabled={state.generating === 'write'}>
                    {state.generating === 'write' ? <><span className="spinner" /> 生成中…</> : 'AI 写章'}
                  </button>
                  <button onClick={polishAI} disabled={state.generating === 'polish'}>
                    {state.generating === 'polish' ? <><span className="spinner" /> 润色中…</> : '一键润色'}
                  </button>
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
                <div className="section-title">高级工具箱</div>
                <div className="action-grid">
                  <button onClick={() => void run(async () => {
                    const phase = await askPrompt('进入阶段 id（topic/setting/character/outline/volume/chapter/writing/revision/done）')
                    if (phase && state.selectedProjectId) await call('projects:phase', { projectId: state.selectedProjectId, phase: phase as never })
                  })}>进入阶段</button>
                  <button onClick={() => void run(async () => {
                    const phase = await askPrompt('提交阶段 id')
                    const artifact = await askPrompt('阶段产物全文')
                    if (phase && artifact && state.selectedProjectId) {
                      const book = await call('projects:commit', { projectId: state.selectedProjectId, phase: phase as never, artifact })
                      void showAlert(`已提交：${book.currentPhase}`, '阶段提交')
                    }
                  })}>提交阶段</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const audit = await call('projects:audit', { projectId: state.selectedProjectId })
                    void showAlert(audit.map((a) => `${a.at} ${a.action} ${a.phase} ${a.detail}`).join('\n') || '暂无审计', '项目审计')
                  })}>审计日志</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const sourceId = await askPrompt('源项目 ID')
                    if (sourceId) { const book = await call('projects:clone', { sourceId }); void showAlert(`已克隆：${book.title}`, '克隆项目'); await refreshWorkspace() }
                  })}>克隆项目</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const advice = await askPrompt('诊断建议')
                    if (advice) { const r = await call('agent:applyAdvice', { text: state.editorText, advice, profileId: state.activeModelId ?? undefined }); setEditorText(r.revised) }
                  })}>应用建议</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId || !state.selectedChapterNo) return
                    const mode = await askPrompt('修订模式（proofread/rhythm/style）', 'proofread')
                    if (mode && ['proofread', 'rhythm', 'style'].includes(mode)) { const r = await call('agent:revise', { projectId: state.selectedProjectId, chapterNo: state.selectedChapterNo, mode: mode as 'proofread' | 'rhythm' | 'style', profileId: state.activeModelId ?? undefined }); setEditorText(r.revised) }
                  })}>AI 修订</button>
                  <button onClick={() => void run(async () => {
                    const stats = await call('chapters:wordcount', { text: state.editorText })
                    void showAlert(`总字符 ${stats.totalChars} · 中文 ${stats.cjkChars} · 段落 ${stats.paragraphs} · 对话占比 ${Math.round(stats.dialogueRatio * 100)}%`, '字数统计')
                  })}>字数统计</button>
                  <button onClick={() => void run(async () => {
                    const lib = await call('prompts:list', undefined)
                    void showAlert(lib.map((p) => `${p.id} · ${p.name}`).join('\n') || '无模板', '提示词库')
                  })}>提示词库</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const items = await call('extras:foreshadows', { projectId: state.selectedProjectId })
                    void showAlert(items.map((f) => `[${f.status}] ${f.content} @${f.plantChapter}`).join('\n') || '无伏笔', '伏笔')
                  })}>伏笔列表</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const content = await askPrompt('伏笔内容')
                    const chapterNo = await askPrompt('埋设章节号', String(state.selectedChapterNo ?? 1))
                    if (content && chapterNo) await call('extras:plantForeshadow', { projectId: state.selectedProjectId, content, plantChapter: Number(chapterNo) })
                  })}>登记伏笔</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const items = await call('extras:glossary', { projectId: state.selectedProjectId })
                    void showAlert(items.map((g) => `${g.term}：${g.definition}`).join('\n') || '无术语', '术语表')
                  })}>术语表</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const term = await askPrompt('术语')
                    const definition = await askPrompt('释义')
                    if (term && definition) await call('extras:addGlossary', { projectId: state.selectedProjectId, term, definition })
                  })}>添加术语</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const items = await call('extras:ideas', { projectId: state.selectedProjectId })
                    void showAlert(items.map((i) => i.content).join('\n') || '无灵感', '灵感库')
                  })}>灵感列表</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const content = await askPrompt('灵感内容')
                    if (content) await call('extras:addIdea', { projectId: state.selectedProjectId, content })
                  })}>添加灵感</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const entries = await call('extras:ledger', { projectId: state.selectedProjectId })
                    void showAlert(entries.map((e) => `${e.entity}.${e.field} = ${e.value} @ch${e.chapterNo}`).join('\n') || '无账本', '事实账本')
                  })}>事实账本</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const events = await call('extras:timeline', { projectId: state.selectedProjectId })
                    void showAlert(events.map((e) => `ch${e.chapterNo} ${e.bookTime} ${e.event}`).join('\n') || '无时间线', '时间线')
                  })}>时间线</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const report = await call('extras:consistencyAudit', { projectId: state.selectedProjectId })
                    const text = [
                      ...report.conflicts.map((c) => `冲突：${c.entity}.${c.field} → ${c.history.map((h) => h.value).join(' | ')}`),
                      ...report.timelineIssues.map((t) => `时间线：${t.message}`),
                      ...report.sedimentSuggestions.map((s) => `沉淀建议：${s.entity}`),
                    ].join('\n') || '无异常'
                    void showAlert(text, '一致性巡检')
                  })}>一致性巡检</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const wizard = await call('guide:wizardStatus', { projectId: state.selectedProjectId })
                    void showAlert(`当前步骤：${wizard.step}\n${Object.entries(wizard.status).map(([k, v]) => `${k}=${v}`).join('\n')}`, '创作向导')
                  })}>向导状态</button>
                  <button onClick={() => void run(async () => {
                    if (!state.selectedProjectId) return
                    const step = await askPrompt('向导步骤（genre/title/setting/outline/start）', 'setting')
                    const artifact = await askPrompt('步骤产物')
                    if (step && artifact) await call('guide:wizardAction', { projectId: state.selectedProjectId, action: 'commit', step: step as never, artifact })
                  })}>提交向导</button>
                  <button onClick={() => void run(async () => {
                    const text = await askPrompt('输入自然语言指令')
                    if (text) { const intent = await call('guide:parseIntent', { text }); void showAlert(intent ? `${intent.action}（置信度 ${intent.confidence}）` : '未命中意图', '意图解析') }
                  })}>意图解析</button>
                  <button onClick={() => void run(async () => {
                    const result = await call('lorebook:exportSillyTavern', undefined)
                    void showAlert(`已导出 ${result.count} 条到 SillyTavern 格式：\n\n${result.content.slice(0, 800)}`, '导出到酒馆')
                  })}>导出到酒馆</button>
                  <button onClick={() => void run(async () => {
                    const content = await askPrompt('粘贴世界书 JSON（Operit/SillyTavern/角色卡）')
                    if (content && state.selectedProjectId) { const r = await call('lorebook:importJson', { content, bookId: state.selectedProjectId }); void showAlert(`导入 ${r.imported} 条`, '世界书导入'); await loadLorebook(state.selectedProjectId) }
                  })}>导入世界书</button>
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
          {state.generating && (
            <div className="generating-bar">
              <div className="generating-progress" />
            </div>
          )}
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

              {state.polishPreview && (
                <div className="polish-panel">
                  <div className="polish-head">
                    <strong>润色预览</strong>
                    <span className="muted">共 {state.polishPreview.suggestions.length} 条建议 · 已采纳 {state.polishPreview.suggestions.filter((s) => s.accepted).length} 条</span>
                    <span className="spacer" />
                    <button onClick={acceptAllPolish}>全部采纳</button>
                    <button onClick={rejectAllPolish}>全部拒绝</button>
                    <button onClick={savePolish}>确认保存</button>
                    <button onClick={discardPolish}>放弃还原</button>
                  </div>
                  <div className="polish-list">
                    {state.polishPreview.suggestions.map((s) => (
                      <div className={`polish-item ${s.accepted ? 'accepted' : ''}`} key={s.id}>
                        <div className="polish-item-head">
                          <b>{s.original === '' ? '（新增段）' : s.polished === '' ? '（删除段）' : `第 ${s.paraIndex} 段`}</b>
                          <button onClick={() => togglePolish(s.id)}>{s.accepted ? '✓ 已采纳 · 撤销' : '采纳这条'}</button>
                        </div>
                        {s.original ? <div className="polish-original">原文：{s.original}</div> : null}
                        {s.polished ? <div className="polish-polished">改后：{s.polished}</div> : null}
                      </div>
                    ))}
                  </div>
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
        <div className="chat-head">AI 对话 · 与助手沟通即可完成写作操作</div>
        <div className="chat-messages">
          {state.chatMessages.map((msg, i) => (
            <div className={`chat-msg ${msg.role}`} key={i}><b>{msg.role === 'user' ? '你' : 'AI'}</b><span>{msg.content}</span></div>
          ))}
          {state.chatMessages.length === 0 && <div className="chat-hint">和 AI 助手对话，可以帮你写章、润色、诊断、管理作品…</div>}
        </div>
        <div className="chat-input-row">
          <select
            className="chat-model-select"
            value={state.activeModelId ?? ''}
            onChange={(e) => patch({ activeModelId: e.target.value || null })}
            title="切换当前对话模型"
          >
            {state.models.length === 0 && <option value="">未配置模型</option>}
            {state.models.map((m) => (
              <option key={m.id} value={m.id}>{m.name} · {m.model}</option>
            ))}
          </select>
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
              <div className="settings-section">
                <h4>已保存模型</h4>
                {state.models.map((m) => (
                  <div className="model-item" key={m.id}>
                    <div>
                      <strong>{m.name}</strong> {state.activeModelId === m.id && <span className="active-badge">当前</span>}
                      <span className="muted">{m.provider} · {m.model}</span>
                    </div>
                    <span>
                      <button onClick={() => patch({ activeModelId: m.id })}>设为当前</button>
                      <button onClick={() => testModel(m.id)}>测试</button>
                      <button onClick={() => deleteModel(m.id)}>删除</button>
                    </span>
                  </div>
                ))}
                {state.models.length === 0 && <div className="empty">还没有模型，在下方添加</div>}
              </div>

              <div className="settings-section">
                <h4>添加模型</h4>
                <label>提供方
                  <select value={state.batchProvider} onChange={(e) => {
                    const provider = e.target.value as ModelProfile['provider']
                    const preset = PROVIDER_PRESETS.find((p) => p.id === provider)
                    patch({ batchProvider: provider, ...(preset ? { batchBaseUrl: preset.baseUrl } : {}) })
                  }}>
                    {PROVIDER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
                <label>Base URL<input value={state.batchBaseUrl} onChange={(e) => patch({ batchBaseUrl: e.target.value })} /></label>
                <label>API Key<input type="password" value={state.batchApiKey} onChange={(e) => patch({ batchApiKey: e.target.value })} /></label>
                <div className="model-fetch-row">
                  <button onClick={fetchRemoteModels} disabled={state.fetchingModels || !state.batchApiKey}>自动获取模型列表</button>
                  <span className="muted">获取后可按住 Ctrl/Shift 多选</span>
                </div>
                {state.remoteModels.length > 0 && (
                  <label>选择模型（可多选）
                    <select
                      multiple
                      size={6}
                      value={state.selectedRemoteModels}
                      onChange={(e) => {
                        const values = Array.from(e.target.selectedOptions, (o) => o.value)
                        patch({ selectedRemoteModels: values })
                      }}
                    >
                      {state.remoteModels.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                )}
                <label>或手动输入模型名（逗号分隔）
                  <input value={state.batchModelNames} onChange={(e) => patch({ batchModelNames: e.target.value })} placeholder="deepseek-chat, deepseek-reasoner" />
                </label>
                <button onClick={saveBatchModels} disabled={state.busy || (state.selectedRemoteModels.length + state.batchModelNames.trim().split(/[\n,，]/).filter(Boolean).length) === 0}>保存所选模型</button>
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

      {state.loreEditor && (
        <LoreEditorModal
          mode={state.loreEditor.mode}
          entry={state.loreEditor.entry}
          defaultBookId={state.selectedProjectId ?? ''}
          onSave={(entry) => { saveLoreEntry(entry); patch({ loreEditor: null }) }}
          onClose={() => patch({ loreEditor: null })}
        />
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

function LoreEditorModal(props: { mode: 'new' | 'edit'; entry?: LoreEntry; defaultBookId: string; onSave: (entry: LoreEntry) => void; onClose: () => void }): JSX.Element {
  const [name, setName] = useState(props.entry?.name ?? '')
  const [content, setContent] = useState(props.entry?.content ?? '')
  const [keywords, setKeywords] = useState(props.entry?.keywords.join('、') ?? '')
  const [priority, setPriority] = useState(String(props.entry?.priority ?? 50))
  const [always, setAlways] = useState(props.entry?.always_active ?? false)
  const [enabled, setEnabled] = useState(props.entry?.enabled ?? true)

  const save = (): void => {
    if (!name.trim() || !content.trim()) return
    const now = new Date().toISOString()
    props.onSave({
      id: props.entry?.id ?? `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      content,
      keywords: keywords.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      is_regex: false,
      case_sensitive: false,
      always_active: always,
      enabled,
      priority: Math.max(0, Math.min(1000, Number(priority) || 50)),
      scan_depth: 0,
      inject_target: 'system',
      inject_position: 'append',
      insertion_depth: 0,
      book_id: props.entry?.book_id ?? props.defaultBookId,
      volume_id: undefined,
      tags: props.entry?.tags ?? [],
      version: props.entry?.version ?? 1,
      created_at: props.entry?.created_at ?? now,
      updated_at: now,
    })
  }

  return (
    <div className="modal-mask" onClick={props.onClose}>
      <div className="modal lore-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{props.mode === 'edit' ? `编辑世界书条目 · ${props.entry?.name}` : '新建世界书条目'}</strong>
          <button onClick={props.onClose}>关闭</button>
        </div>
        <div className="modal-body">
          <div className="settings-section">
            <label>条目名称
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：林远" />
            </label>
            <label>触发关键词（逗号分隔）
              <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="林远,主角,青莲剑诀" />
            </label>
            <label>优先级（0-1000）
              <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </label>
            <label>注入内容
              <textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)} placeholder="在这里输入世界书条目内容，可包含设定、人物、势力、境界等。" />
            </label>
            <div className="lore-check-row">
              <label><input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> 常驻注入</label>
              <label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 启用</label>
            </div>
          </div>
          <div className="modal-actions">
            <button onClick={props.onClose}>取消</button>
            <button onClick={save} disabled={!name.trim() || !content.trim()}>保存条目</button>
          </div>
        </div>
      </div>
    </div>
  )
}