/**
 * 右侧结果面板 — 润色逐条采纳 / 各类检查结果卡片。
 */
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
  const busy = useStore((s) => s.busy)

  if (!panel) return null

  const copyText = async (text: string): Promise<void> => {
    await navigator.clipboard.writeText(text)
    useStore.getState().notify('已复制到剪贴板')
  }

  return (
    <aside className="right-panel">
      <div className="right-panel-head">
        <strong>{panel.kind === 'polish' ? '润色建议' : panel.title}</strong>
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

      {panel.kind === 'result' && (
        <div className="right-panel-body">
          <div className="result-card">
            <pre>{panel.text}</pre>
          </div>
          <div className="polish-actions">
            <button onClick={() => void copyText(panel.text)}><IconCopy size={13} /> 复制全文</button>
          </div>
        </div>
      )}
    </aside>
  )
}
