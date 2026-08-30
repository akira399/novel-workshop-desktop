/**
 * 中央编辑区 — 章节标题 + AI 动作条 + CodeMirror 正文 + 状态栏。
 */
import { useMemo, useRef, useState } from 'react'
import { countChapter } from '@dafuyu/core/stats'
import { useStore } from '../store'
import { genreLabel } from '../constants'
import { IconRedo, IconSearch, IconSparkles, IconUndo, IconX } from './Icons'
import { StatusBar } from './StatusBar'
import { EditorPane, type EditorApi } from './EditorPane'

export function EditorArea(): JSX.Element {
  const projectId = useStore((s) => s.projectId)
  const book = useStore((s) => s.book)
  const chapterNo = useStore((s) => s.chapterNo)
  const editorTitle = useStore((s) => s.editorTitle)
  const setEditorTitle = useStore((s) => s.setEditorTitle)
  const editorText = useStore((s) => s.editorText)
  const setEditorText = useStore((s) => s.setEditorText)
  const saveChapter = useStore((s) => s.saveChapter)
  const dirty = useStore((s) => s.dirty)
  const saving = useStore((s) => s.saving)
  const fontSize = useStore((s) => s.fontSize)
  const setFontSize = useStore((s) => s.setFontSize)
  const generating = useStore((s) => s.generating)
  const activeOpId = useStore((s) => s.activeOpId)
  const cancelActiveOp = useStore((s) => s.cancelActiveOp)
  const writeChapterAI = useStore((s) => s.writeChapterAI)
  const polishAI = useStore((s) => s.polishAI)
  const depolishAI = useStore((s) => s.depolishAI)
  const styleConvertAI = useStore((s) => s.styleConvertAI)
  const reviseAI = useStore((s) => s.reviseAI)
  const validateAI = useStore((s) => s.validateAI)
  const diagnoseAI = useStore((s) => s.diagnoseAI)
  const newChapter = useStore((s) => s.newChapter)
  const createProject = useStore((s) => s.createProject)
  const importFile = useStore((s) => s.importFile)
  const importDemo = useStore((s) => s.importDemo)

  const apiRef = useRef<EditorApi | null>(null)
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false })
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')

  const stats = useMemo(() => countChapter(editorText, 0), [editorText])

  const doFind = (): void => {
    if (!findText) return
    apiRef.current?.find(findText)
    apiRef.current?.focus()
  }

  const doReplaceAll = (): void => {
    if (!findText) return
    apiRef.current?.replaceAll(findText, replaceText)
  }

  if (!projectId || !book) {
    return (
      <div className="editor-card welcome-card">
        <div className="welcome">
          <div className="welcome-mark">坊</div>
          <h1>大肥鱼的小说工坊</h1>
          <p className="muted">从选题到完本的 AI 小说创作工作台</p>
          <div className="welcome-actions">
            <button className="primary" onClick={() => void createProject()}>新建作品</button>
            <button onClick={() => void importDemo()}>载入示例</button>
            <button onClick={() => void importFile()}>导入本地书籍</button>
          </div>
          <div className="welcome-steps">
            <span>1 · 新建作品</span>
            <span>2 · 模型设置里接入 AI</span>
            <span>3 · 一键写章或对话创作</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="editor-card">
      {generating && (
        <div className="generating-bar">
          <div className="generating-progress" />
        </div>
      )}

      <div className="editor-toolbar">
        <input
          className="chapter-title"
          value={editorTitle}
          onChange={(e) => setEditorTitle(e.target.value)}
          placeholder="章节标题"
          spellCheck={false}
        />
        <span className={`dirty-dot ${dirty ? 'on' : ''}`} title={dirty ? '未保存' : '已保存'} />
        <div className="v-divider" />
        <button className="icon-btn" title="撤销 (Ctrl+Z)" disabled={!undoState.canUndo} onClick={() => apiRef.current?.undo()}><IconUndo size={14} /></button>
        <button className="icon-btn" title="重做 (Ctrl+Y)" disabled={!undoState.canRedo} onClick={() => apiRef.current?.redo()}><IconRedo size={14} /></button>
        <button className={`icon-btn ${findOpen ? 'active' : ''}`} title="查找替换" onClick={() => setFindOpen(!findOpen)}><IconSearch size={14} /></button>
        <button className="icon-btn text-btn" title="缩小字号" onClick={() => void setFontSize(fontSize - 1)}>A-</button>
        <button className="icon-btn text-btn" title="放大字号" onClick={() => void setFontSize(fontSize + 1)}>A+</button>
        <button
          className={`save-btn ${saving ? 'working' : dirty ? 'dirty' : ''}`}
          onClick={() => void saveChapter(true)}
          disabled={saving || !dirty}
        >
          {saving ? '保存中…' : dirty ? '保存' : '已保存'}
        </button>
      </div>

      <div className="ai-strip">
        <span className="ai-strip-label"><IconSparkles size={13} /> AI</span>
        <button className="chip" disabled={generating !== null} onClick={() => void writeChapterAI()}>
          {generating === 'write' ? <><span className="spinner" /> 生成中…</> : '写章'}
        </button>
        <button className="chip" disabled={generating !== null} onClick={() => void polishAI()}>
          {generating === 'polish' ? <><span className="spinner" /> 润色中…</> : '润色'}
        </button>
        <button className="chip" disabled={generating !== null} onClick={() => void depolishAI()}>去 AI 味</button>
        <button className="chip" disabled={generating !== null} onClick={() => void styleConvertAI()}>文风</button>
        <button className="chip" disabled={generating !== null} onClick={() => void reviseAI()}>修订</button>
        {generating && activeOpId && (
          <button className="chip stop-chip" onClick={() => void cancelActiveOp()}>■ 停止</button>
        )}
        <span className="flex-spacer" />
        <button className="chip" onClick={() => void validateAI()}>校验</button>
        <button className="chip" onClick={() => void diagnoseAI()}>诊断</button>
      </div>

      {findOpen && (
        <div className="find-bar">
          <input autoFocus value={findText} onChange={(e) => setFindText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doFind() }} placeholder="查找" />
          <button onClick={doFind}>查找下一个</button>
          <input value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder="替换为" />
          <button onClick={doReplaceAll}>全部替换</button>
          <button className="icon-btn" title="关闭" onClick={() => setFindOpen(false)}><IconX size={13} /></button>
        </div>
      )}

      <EditorPane
        text={editorText}
        fontSize={fontSize}
        chapterKey={`${projectId}:${chapterNo ?? 'none'}`}
        onChange={(text) => setEditorText(text, { fromEditor: true })}
        onStateChange={setUndoState}
        apiRef={apiRef}
      />

      <StatusBar
        left={[book.title, genreLabel(book.genre), editorTitle.trim() || (chapterNo != null ? `第 ${chapterNo} 章` : '')].filter(Boolean).join(' · ')}
        words={stats.totalChars}
        paragraphs={stats.paragraphs}
      />
    </div>
  )
}
