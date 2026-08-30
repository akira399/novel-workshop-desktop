/**
 * 弹窗宿主 — 确认 / 输入 / 选择 / 多选 / 结果 五种对话框，promise 驱动。
 */
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { DialogRequest } from '../store'
import { IconCopy } from './Icons'

export function DialogHost(): JSX.Element | null {
  const dialog = useStore((s) => s.dialog)

  if (!dialog) return null
  return <DialogRenderer dialog={dialog} />
}

function DialogRenderer({ dialog }: { dialog: DialogRequest }): JSX.Element {
  const close = (value: unknown): void => {
    if (dialog.type === 'confirm') (dialog.resolve as (v: boolean) => void)(value as boolean)
    else (dialog.resolve as (v: never) => void)(value as never)
    useStore.setState({ dialog: null })
  }

  return (
    <div className="modal-mask">
      {dialog.type === 'confirm' && (
        <div className="modal dialog-sm" onClick={(e) => e.stopPropagation()}>
          <div className="modal-title">{dialog.title}</div>
          <div className="modal-message">{dialog.message}</div>
          <div className="modal-actions">
            <button onClick={() => close(false)}>取消</button>
            <button className={dialog.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{dialog.confirmLabel ?? '确定'}</button>
          </div>
          <EscHandler onCancel={() => close(false)} />
        </div>
      )}

      {dialog.type === 'prompt' && (
        <PromptDialog dialog={dialog} onClose={close} />
      )}

      {dialog.type === 'select' && (
        <SelectDialog dialog={dialog} onClose={close} />
      )}

      {dialog.type === 'choices' && (
        <div className="modal dialog-sm" onClick={(e) => e.stopPropagation()}>
          <div className="modal-title">{dialog.title}</div>
          {dialog.message && <div className="modal-message">{dialog.message}</div>}
          <div className="modal-actions wrap">
            {dialog.choices.map((c) => (
              <button key={c.value} className={c.danger ? 'danger' : c.primary ? 'primary' : ''} onClick={() => close(c.value)}>{c.label}</button>
            ))}
          </div>
          <EscHandler onCancel={() => close(null)} />
        </div>
      )}

      {dialog.type === 'result' && (
        <div className="modal dialog-md" onClick={(e) => e.stopPropagation()}>
          <div className="modal-title with-copy">
            {dialog.title}
            <button className="icon-btn" title="复制" onClick={() => { void navigator.clipboard.writeText(dialog.content); useStore.getState().notify('已复制') }}>
              <IconCopy size={14} />
            </button>
          </div>
          <div className="modal-result"><pre>{dialog.content}</pre></div>
          <div className="modal-actions">
            <button className="primary" onClick={() => close(undefined)}>关闭</button>
          </div>
        </div>
      )}
    </div>
  )
}

function PromptDialog({ dialog, onClose }: { dialog: Extract<DialogRequest, { type: 'prompt' }>; onClose: (v: string | null) => void }): JSX.Element {
  const [value, setValue] = useState(dialog.defaultValue ?? '')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  return (
    <div className="modal dialog-sm" onClick={(e) => e.stopPropagation()}>
      <div className="modal-title">{dialog.title}</div>
      {dialog.message && <div className="modal-message">{dialog.message}</div>}
      {dialog.multiline ? (
        <textarea
          ref={inputRef}
          rows={6}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={dialog.placeholder}
          className="modal-input"
        />
      ) : (
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onClose(value) } if (e.key === 'Escape') onClose(null) }}
          placeholder={dialog.placeholder}
          className="modal-input single"
        />
      )}
      <div className="modal-actions">
        <button onClick={() => onClose(null)}>取消</button>
        <button className="primary" onClick={() => onClose(value)}>确定</button>
      </div>
    </div>
  )
}

function SelectDialog({ dialog, onClose }: { dialog: Extract<DialogRequest, { type: 'select' }>; onClose: (v: string | null) => void }): JSX.Element {
  const [value, setValue] = useState(dialog.value ?? dialog.options[0]?.value ?? '')
  return (
    <div className="modal dialog-sm" onClick={(e) => e.stopPropagation()}>
      <div className="modal-title">{dialog.title}</div>
      {dialog.message && <div className="modal-message">{dialog.message}</div>}
      <div className="option-list">
        {dialog.options.map((opt) => (
          <button
            key={opt.value}
            className={`option-row ${opt.value === value ? 'selected' : ''}`}
            onClick={() => { setValue(opt.value); onClose(opt.value) }}
            onDoubleClick={() => onClose(opt.value)}
          >
            <span>{opt.label}</span>
            {opt.hint && <span className="muted">{opt.hint}</span>}
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button onClick={() => onClose(null)}>取消</button>
      </div>
      <EscHandler onCancel={() => onClose(null)} />
    </div>
  )
}

function EscHandler({ onCancel }: { onCancel: () => void }): null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return null
}
