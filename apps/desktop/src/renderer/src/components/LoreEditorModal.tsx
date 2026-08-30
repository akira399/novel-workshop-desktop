/**
 * 世界书条目编辑弹窗。
 */
import { useState } from 'react'
import type { LoreEntry } from '@dafuyu/core/types'
import { useStore } from '../store'
import { IconX } from './Icons'

export function LoreEditorModal(): JSX.Element | null {
  const loreEditor = useStore((s) => s.loreEditor)
  const close = useStore((s) => s.closeLoreEditor)
  const saveLoreEntry = useStore((s) => s.saveLoreEntry)
  const projectId = useStore((s) => s.projectId)

  const [name, setName] = useState(loreEditor?.entry?.name ?? '')
  const [content, setContent] = useState(loreEditor?.entry?.content ?? '')
  const [keywords, setKeywords] = useState(loreEditor?.entry?.keywords.join('、') ?? '')
  const [priority, setPriority] = useState(String(loreEditor?.entry?.priority ?? 50))
  const [always, setAlways] = useState(loreEditor?.entry?.always_active ?? false)
  const [enabled, setEnabled] = useState(loreEditor?.entry?.enabled ?? true)

  if (!loreEditor) return null
  const entry = loreEditor.entry

  const save = (): void => {
    if (!name.trim() || !content.trim()) return
    const now = new Date().toISOString()
    const next: LoreEntry = {
      id: entry?.id ?? `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
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
      book_id: entry?.book_id ?? projectId ?? '',
      volume_id: undefined,
      tags: entry?.tags ?? [],
      version: entry?.version ?? 1,
      created_at: entry?.created_at ?? now,
      updated_at: now,
    }
    void saveLoreEntry(next)
    close()
  }

  return (
    <div className="modal-mask" onClick={close}>
      <div className="modal dialog-md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title bar">
          {loreEditor.mode === 'edit' ? `编辑条目 · ${entry?.name}` : '新建世界书条目'}
          <button className="icon-btn" onClick={close} title="关闭"><IconX size={15} /></button>
        </div>
        <div className="modal-form">
          <label className="field">
            <span>条目名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：林远" />
          </label>
          <label className="field">
            <span>触发关键词（顿号 / 逗号分隔）</span>
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="林远, 主角, 青莲剑诀" />
          </label>
          <label className="field narrow">
            <span>优先级（0-1000，越高越先注入）</span>
            <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </label>
          <label className="field">
            <span>注入内容</span>
            <textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)} placeholder="设定、人物、势力、境界……写入此处的正文会在触发关键词时注入给 AI" />
          </label>
          <div className="check-row">
            <label><input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> 常驻注入（每章都带）</label>
            <label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 启用</label>
          </div>
          <div className="modal-actions">
            <button onClick={close}>取消</button>
            <button className="primary" disabled={!name.trim() || !content.trim()} onClick={save}>保存条目</button>
          </div>
        </div>
      </div>
    </div>
  )
}
