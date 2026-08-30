/**
 * 右侧结果面板 — 润色逐条采纳 / AI 写回 diff 确认 / 检查结果与流式预览卡片。
 */
import { useMemo } from 'react'
import { diffSentences } from '@dafuyu/core/polish'
import { useStore } from '../store'
import { IconCopy, IconX } from './Icons'

export function RightPanel(): JSX.Element | null {
  const panel = useStore((s) => s.rightPanel)
  const close = useStore((s) => s.closeRightPanel)
  const polishPreview = useStore((s) => s.polishPreview)
  const togglePolish = useStore((s) => s.togglePolish)
  const acceptAllPolish = useStore((s) => s.acceptAllPolish)
  const rejectAllPolish = useStore((s) => s.rejectAllPolish)
  const discardPolish = useStore((s) => s.discardPolish)
  const savePolish = useStore((s) => s.savePolish)
  const applyDiff = useStore((s) => s.applyDiff)
  const busy = useStore((s) => s.busy)
  const streaming = useStore((s) => s.streamTarget === 'panel')
  const streamText = useStore((s) => s.streamText)

  const diffChunks = useMemo(() => {
    if (!panel || panel.kind !== 'diff') return []
    return diffSentences(panel.original, panel.next)
  }, [panel])
  const diffChangeCount = useMemo(() => diffChunks.filter((c) => c.type !== 'same').length, [diffChunks])

  if (!panel) return null

  const copyText = async (text: string): Promise<void> => {
    await navigator.clipboard.writeText(text)
    useStore.getState().notify('已复制到剪贴板')
  }

  const title = panel.kind === 'polish'
    ? '润色建议'
    : panel.kind === 'diff'
      ? 'AI 修改建议'
      : panel.title

  return (
    <aside className="right-panel">
      <div className="right-panel-head">
        <strong className="right-panel-title">
          {title}
          {streaming && <span className="spinner" />}
        </strong>
        <button className="icon-btn" onClick={close} title="关闭"><IconX size={14} /></button>
      </div>

      {panel.kind === 'polish' && polishPreview && (
        <div className="right-panel-body">
          <div className="polish-summary">
            共 {polishPreview.suggestions.length} 条建议 · 已采纳 {polishPreview.suggestions.filter((s) => s.accepted).length} 条
          </div>
          <div className="polish-actions">
            <button onClick={acceptAllPolish}>全部采纳</button>
            <button onClick={rejectAllPolish}>全部拒绝</button>
            <button className="primary" disabled={busy} onClick={() => void savePolish()}>保存</button>
            <button className="danger-ghost" onClick={discardPolish}>放弃</button>
          </div>
          <div className="polish-list">
            {polishPreview.suggestions.map((s) => (
              <div className={`polish-item ${s.accepted ? 'accepted' : ''}`} key={s.id}>
                <button className="polish-item-head" onClick={() => togglePolish(s.id)}>
                  <b>{s.original === '' ? '（新增段）' : s.polished === '' ? '（删除段）' : `第 ${s.paraIndex} 段`}</b>
                  <span>{s.accepted ? '✓ 已采纳' : '采纳'}</span>
                </button>
                {s.original && <div className="polish-original">{s.original}</div>}
                {s.polished && <div className="polish-polished">{s.polished}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {panel.kind === 'diff' && (
        <div className="right-panel-body">
          <div className="polish-summary">
            AI 建议修改正文（{diffChangeCount} 处变化），确认后才会写入编辑器。
          </div>
          <div className="polish-actions">
            <button className="primary" onClick={applyDiff}>应用到编辑器</button>
            <button className="danger-ghost" onClick={close}>放弃</button>
          </div>
          <div className="diff-view">
            {diffChunks.map((c, i) => (
              c.type === 'same'
                ? <span key={i}>{c.text}</span>
                : c.type === 'del'
                  ? <del key={i} className="diff-del">{c.text}</del>
                  : <ins key={i} className="diff-add">{c.text}</ins>
            ))}
          </div>
        </div>
      )}

      {panel.kind === 'result' && (
        <div className="right-panel-body">
          <div className="result-card">
            <pre>{streaming ? streamText : panel.text}</pre>
          </div>
          {!streaming && panel.text && (
            <div className="polish-actions">
              <button onClick={() => void copyText(panel.text)}><IconCopy size={13} /> 复制全文</button>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
