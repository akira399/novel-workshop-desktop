/**
 * CodeMirror 6 编辑器 — 网文写作排版（衬线正文、段首缩进、居中栏宽）。
 * 撤销/重做与查找替换走 CM 内建能力；正文与 store 双向同步；
 * AI 写回通过事务替换保留撤销历史。
 */
import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, highlightSpecialChars, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { SearchQuery, findNext, findPrevious, replaceAll, search, searchKeymap, setSearchQuery } from '@codemirror/search'

export interface EditorApi {
  undo(): void
  redo(): void
  focus(): void
  find(query: string): void
  findPrevious(): void
  replaceAll(query: string, replacement: string): void
}

interface EditorPaneProps {
  text: string
  fontSize: number
  /** 章节标识：变化时整体重建实例（撤销历史随之清空） */
  chapterKey: string
  onChange: (text: string) => void
  onStateChange?: (info: { canUndo: boolean; canRedo: boolean }) => void
  apiRef: { current: EditorApi | null }
}

export function EditorPane({ text, fontSize, chapterKey, onChange, onStateChange, apiRef }: EditorPaneProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  // 创建实例（切章时 chapterKey 变化 → 整体重建，历史清空）
  useEffect(() => {
    if (!hostRef.current) return
    const extensions: Extension[] = [
      EditorView.lineWrapping,
      drawSelection(),
      dropCursor(),
      highlightSpecialChars(),
      history(),
      placeholder('在此编辑小说正文…'),
      search(),
      EditorView.contentAttributes.of({ spellcheck: 'false' }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        if (onStateChangeRef.current) {
          onStateChangeRef.current({
            canUndo: undo(update.view),
            canRedo: redo(update.view),
          })
        }
      }),
    ]
    const view = new EditorView({
      state: EditorState.create({ doc: text, extensions }),
      parent: hostRef.current,
    })
    viewRef.current = view
    apiRef.current = {
      undo: () => { undo(view) },
      redo: () => { redo(view) },
      focus: () => { view.focus() },
      find: (query: string) => {
        view.dispatch({
          effects: setSearchQuery.of(new SearchQuery({ search: query, caseSensitive: false })),
        })
        findNext(view)
      },
      findPrevious: () => { findPrevious(view) },
      replaceAll: (query: string, replacement: string) => {
        view.dispatch({
          effects: setSearchQuery.of(new SearchQuery({ search: query, replace: replacement, caseSensitive: false })),
        })
        replaceAll(view)
      },
    }
    return () => {
      apiRef.current = null
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterKey])

  // 外部正文变化（AI 写回等）→ 事务替换，保留撤销历史
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === text) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: text },
      selection: { anchor: 0 },
    })
  }, [text])

  // 字号：由外层容器继承
  return (
    <div className="editor-pane" style={{ fontSize }} ref={hostRef} />
  )
}
