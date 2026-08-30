/**
 * 作品库面板 — 新建 / 导入 / 选择作品。
 */
import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { genreLabel } from '../../constants'
import { IconPlus, IconSearch } from '../Icons'

function relativeDate(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const day = 24 * 3600 * 1000
  if (diff < day) return '今天'
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))} 周前`
  return new Date(t).toLocaleDateString('zh-CN')
}

export function ProjectsPanel(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const projectId = useStore((s) => s.projectId)
  const openProject = useStore((s) => s.openProject)
  const createProject = useStore((s) => s.createProject)
  const importFile = useStore((s) => s.importFile)
  const importDemo = useStore((s) => s.importDemo)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => p.title.toLowerCase().includes(q) || p.genre.toLowerCase().includes(q))
  }, [projects, query])

  return (
    <div className="panel-body">
      <div className="panel-actions">
        <button className="primary" onClick={() => void createProject()}><IconPlus size={14} /> 新建作品</button>
        <button onClick={() => void importFile()}>导入书籍</button>
        <button onClick={() => void importDemo()}>示例</button>
      </div>

      {projects.length > 3 && (
        <div className="panel-search">
          <IconSearch size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索作品…" />
        </div>
      )}

      <div className="panel-list">
        {filtered.map((p) => (
          <button
            key={p.id}
            className={`list-row project-row ${p.id === projectId ? 'current' : ''}`}
            onClick={() => { if (p.id !== projectId) void openProject(p.id) }}
          >
            <div className="row-line-1">
              <strong>{p.title}</strong>
              {p.id === projectId && <span className="badge">当前</span>}
            </div>
            <div className="row-line-2">
              {genreLabel(p.genre)} · {p.chapterCount} 章 · {p.totalWords.toLocaleString()} 字 · {relativeDate(p.updatedAt)}
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="panel-empty">
            {projects.length === 0 ? (
              <>
                <p>还没有作品</p>
                <p className="muted">点击上方「新建作品」开始创作，<br />或导入本地 txt / md 书籍。</p>
              </>
            ) : <p className="muted">没有匹配的作品</p>}
          </div>
        )}
      </div>
    </div>
  )
}
