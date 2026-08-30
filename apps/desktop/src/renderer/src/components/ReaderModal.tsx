/**
 * 本地阅读弹窗（txt / md 内置打开）。
 */
import { useStore } from '../store'
import { IconX } from './Icons'

export function ReaderModal(): JSX.Element | null {
  const reader = useStore((s) => s.reader)
  const close = useStore((s) => s.closeReader)
  if (!reader) return null

  return (
    <div className="modal-mask" onClick={close}>
      <div className="modal dialog-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title bar">
          本地阅读 · {reader.path.split(/[\\/]/).at(-1)}
          <button className="icon-btn" onClick={close} title="关闭"><IconX size={15} /></button>
        </div>
        <div className="modal-result reader">
          {reader.text !== null ? <pre>{reader.text}</pre> : <p className="muted">该格式已交给系统默认程序打开（PDF / EPUB）。</p>}
        </div>
      </div>
    </div>
  )
}
