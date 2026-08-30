/**
 * 世界书面板 — 分组、条目、AI 生成与导入导出。
 */
import { useStore } from '../../store'
import { IconPencil, IconPlus, IconTrash } from '../Icons'

export function LorebookPanel(): JSX.Element {
  const lorebook = useStore((s) => s.lorebook)
  const projectId = useStore((s) => s.projectId)
  const autogenLorebook = useStore((s) => s.autogenLorebook)
  const marketResearch = useStore((s) => s.marketResearch)
  const openLoreEditor = useStore((s) => s.openLoreEditor)
  const deleteLoreEntry = useStore((s) => s.deleteLoreEntry)
  const createLoreGroup = useStore((s) => s.createLoreGroup)
  const renameLoreGroup = useStore((s) => s.renameLoreGroup)
  const toggleLoreGroup = useStore((s) => s.toggleLoreGroup)
  const deleteLoreGroup = useStore((s) => s.deleteLoreGroup)
  const exportSillyTavern = useStore((s) => s.exportSillyTavern)
  const importLoreJson = useStore((s) => s.importLoreJson)

  const groups = lorebook?.groups ?? []
  const entries = lorebook?.entries ?? []
  const groupName = (id: string | undefined): string | null => {
    if (!id) return null
    return groups.find((g) => g.id === id)?.name ?? null
  }

  return (
    <div className="panel-body">
      <div className="panel-actions">
        <button className="primary" disabled={!projectId} onClick={() => void autogenLorebook()}>AI 生成设定</button>
        <button onClick={() => void marketResearch()}>市场调研</button>
      </div>

      <div className="panel-section">
        <div className="panel-section-head">
          <span>分组</span>
          <button className="icon-btn" title="新建分组" onClick={() => void createLoreGroup()}><IconPlus size={13} /></button>
        </div>
        {groups.map((g) => (
          <div className="list-row slim" key={g.id}>
            <div className="chapter-info">
              <div className="row-line-1">
                <strong>{g.name}</strong>
                {!g.enabled && <span className="badge muted-badge">停用</span>}
              </div>
              <div className="row-line-2">{g.entry_ids.length} 条</div>
            </div>
            <div className="row-hover-actions">
              <button className="icon-btn" title="重命名" onClick={() => void renameLoreGroup(g.id, g.name)}><IconPencil size={12} /></button>
              <button className="icon-btn" title={g.enabled ? '停用' : '启用'} onClick={() => void toggleLoreGroup(g.id, !g.enabled)}>{g.enabled ? '⏸' : '▶'}</button>
              <button className="icon-btn danger" title="删除分组" onClick={() => void deleteLoreGroup(g.id)}><IconTrash size={12} /></button>
            </div>
          </div>
        ))}
        {groups.length === 0 && <div className="panel-empty"><p className="muted">暂无分组</p></div>}
      </div>

      <div className="panel-section">
        <div className="panel-section-head">
          <span>条目（{entries.length}）</span>
          <button className="icon-btn" title="新建条目" onClick={() => openLoreEditor('new')}><IconPlus size={13} /></button>
        </div>
        {entries.map((entry) => (
          <div className="list-row slim" key={entry.id} onClick={() => openLoreEditor('edit', entry)} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') openLoreEditor('edit', entry) }}>
            <div className="chapter-info">
              <div className="row-line-1">
                <strong>{entry.name}</strong>
                {entry.always_active && <span className="badge">常驻</span>}
                {groupName(entry.book_id) && <span className="badge muted-badge">{groupName(entry.book_id)}</span>}
              </div>
              <div className="row-line-2">{entry.keywords.slice(0, 3).join('、') || '（无关键词）'}</div>
            </div>
            <div className="row-hover-actions">
              <button className="icon-btn danger" title="删除" onClick={(e) => { e.stopPropagation(); void deleteLoreEntry(entry.id) }}><IconTrash size={12} /></button>
            </div>
          </div>
        ))}
        {entries.length === 0 && <div className="panel-empty"><p className="muted">暂无条目，可用 AI 生成或手动新建</p></div>}
      </div>

      <div className="panel-footnote row-gap">
        <button className="link-btn" onClick={() => void exportSillyTavern()}>导出到酒馆</button>
        <button className="link-btn" onClick={() => void importLoreJson()}>导入 JSON</button>
      </div>
    </div>
  )
}
