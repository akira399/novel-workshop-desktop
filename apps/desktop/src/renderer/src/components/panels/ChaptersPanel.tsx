/**
 * 章节面板 — 章节列表（替代旧版下拉框）：选择、新建、重命名、删除。
 */
import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { IconPencil, IconPlus, IconSearch, IconTrash } from '../Icons'

export function ChaptersPanel(): JSX.Element {
  const chapters = useStore((s) => s.chapters)
  const chapterNo = useStore((s) => s.chapterNo)
  const loadChapter = useStore((s) => s.loadChapter)
  const newChapter = useStore((s) => s.newChapter)
  const renameChapter = useStore((s) => s.renameChapter)
  const deleteChapter = useStore((s) => s.deleteChapter)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return chapters
    return chapters.filter((c) => c.title.toLowerCase().includes(q) || String(c.no).includes(q))
  }, [chapters, query])

  return (
    <div className="panel-body">
      <div className="panel-actions">
        <button className="primary" onClick={newChapter}><IconPlus size={14} /> 新建章节</button>
      </div>

      {chapters.length > 8 && (
        <div className="panel-search">
          <IconSearch size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索章节…" />
        </div>
      )}

      <div className="panel-list">
        {filtered.map((c) => (
          <div
            key={c.no}
            className={`list-row chapter-row ${c.no === chapterNo ? 'current' : ''}`}
            onClick={() => { if (c.no !== chapterNo) void loadChapter(c.no) }}
            onDoubleClick={() => void renameChapter(c.no)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' && c.no !== chapterNo) void loadChapter(c.no) }}
          >
            <span className="chapter-no">{String(c.no).padStart(2, '0')}</span>
            <div className="chapter-info">
              <div className="row-line-1"><strong>{c.title}</strong></div>
              <div className="row-line-2">{c.words.toLocaleString()} 字</div>
            </div>
            <div className="row-hover-actions">
              <button className="icon-btn" title="重命名" onClick={(e) => { e.stopPropagation(); void renameChapter(c.no) }}><IconPencil size={13} /></button>
              <button className="icon-btn danger" title="删除" onClick={(e) => { e.stopPropagation(); void deleteChapter(c.no) }}><IconTrash size={13} /></button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="panel-empty">
            <p className="muted">{chapters.length === 0 ? '还没有章节，点击上方「新建章节」开始' : '没有匹配的章节'}</p>
          </div>
        )}
      </div>

      <div className="panel-footnote">
        单击选择章节 · 双击重命名
      </div>
    </div>
  )
}
