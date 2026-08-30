/**
 * 资料库面板 — 伏笔 / 术语 / 灵感 / 时间线 / 事实账本 / 素材库 / 一致性巡检。
 */
import { useCallback, useEffect, useState } from 'react'
import type { Foreshadow, GlossaryTerm, Idea } from '@dafuyu/core/auxiliary'
import type { LedgerEntry, TimelineEvent } from '@dafuyu/core/consistency'
import type { LibraryEntry } from '@dafuyu/contracts'
import { call } from '../../ipc'
import { useStore } from '../../store'
import { IconPlus, IconTrash } from '../Icons'

type TabKey = 'foreshadow' | 'glossary' | 'ideas' | 'timeline' | 'ledger' | 'library'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'foreshadow', label: '伏笔' },
  { key: 'glossary', label: '术语' },
  { key: 'ideas', label: '灵感' },
  { key: 'timeline', label: '时间线' },
  { key: 'ledger', label: '账本' },
  { key: 'library', label: '素材库' },
]

const FORESHADOW_STATUS: Record<string, string> = {
  open: '已埋设',
  revealed: '已回收',
  dropped: '已放弃',
}

export function DataPanel(): JSX.Element {
  const projectId = useStore((s) => s.projectId)
  const editorText = useStore((s) => s.editorText)
  const chapterNo = useStore((s) => s.chapterNo)
  const askConfirm = useStore((s) => s.askConfirm)
  const askPrompt = useStore((s) => s.askPrompt)
  const askSelect = useStore((s) => s.askSelect)
  const run = useStore((s) => s.run)
  const notify = useStore((s) => s.notify)
  const fail = useStore((s) => s.fail)
  const openRightPanel = useStore((s) => s.openRightPanel)

  const [tab, setTab] = useState<TabKey>('foreshadow')
  const [foreshadows, setForeshadows] = useState<Foreshadow[]>([])
  const [glossary, setGlossary] = useState<GlossaryTerm[]>([])
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [library, setLibrary] = useState<LibraryEntry[]>([])

  const load = useCallback(async (which: TabKey): Promise<void> => {
    if (!projectId) return
    if (which === 'foreshadow') setForeshadows(await call('extras:foreshadows', { projectId }))
    else if (which === 'glossary') setGlossary(await call('extras:glossary', { projectId }))
    else if (which === 'ideas') setIdeas(await call('extras:ideas', { projectId }))
    else if (which === 'timeline') setTimeline(await call('extras:timeline', { projectId }))
    else if (which === 'ledger') setLedger(await call('extras:ledger', { projectId }))
    else setLibrary(await call('library:list', {}))
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    void run(async () => { await load(tab) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tab])

  const plantForeshadow = async (): Promise<void> => {
    const content = await askPrompt('伏笔内容', '', { placeholder: '如：主角佩剑上的裂纹', multiline: true })
    if (!content) return
    const chapter = await askPrompt('埋设章节号', String(chapterNo ?? 1))
    if (!chapter) return
    await run(async () => {
      await call('extras:plantForeshadow', { projectId: projectId!, content, plantChapter: Number(chapter) || 1 })
      await load('foreshadow')
    }, '伏笔已登记')
  }

  const revealForeshadow = async (item: Foreshadow): Promise<void> => {
    const chapter = await askPrompt('回收章节号', String(chapterNo ?? item.plantChapter))
    if (!chapter) return
    await run(async () => {
      await call('extras:revealForeshadow', { projectId: projectId!, id: item.id, chapterNo: Number(chapter) || 1 })
      await load('foreshadow')
    }, '伏笔已回收')
  }

  const dropForeshadow = async (item: Foreshadow): Promise<void> => {
    const ok = await askConfirm('放弃伏笔', '确定放弃这条伏笔吗？（不再计入巡检）', { confirmLabel: '放弃', danger: true })
    if (!ok) return
    await run(async () => {
      await call('extras:dropForeshadow', { projectId: projectId!, id: item.id })
      await load('foreshadow')
    })
  }

  const addGlossary = async (): Promise<void> => {
    const term = await askPrompt('术语', '', { placeholder: '如：青莲剑诀' })
    if (!term) return
    const definition = await askPrompt('释义', '', { multiline: true })
    if (!definition) return
    await run(async () => {
      await call('extras:addGlossary', { projectId: projectId!, term, definition })
      await load('glossary')
    }, '术语已添加')
  }

  const extractGlossary = async (): Promise<void> => {
    if (!editorText.trim()) {
      fail('当前章节没有正文可供提取')
      return
    }
    await run(async () => {
      const names = await call('extras:extractGlossary', { text: editorText })
      if (names.length === 0) { notify('未发现候选术语'); return }
      openRightPanel({ kind: 'result', title: `候选术语（${names.length}）`, text: names.join('\n') })
    })
  }

  const addIdea = async (): Promise<void> => {
    const content = await askPrompt('记录灵感', '', { placeholder: '随时记下灵感，不拘长短', multiline: true })
    if (!content) return
    await run(async () => {
      await call('extras:addIdea', { projectId: projectId!, content })
      await load('ideas')
    }, '灵感已记录')
  }

  const recordTimeline = async (): Promise<void> => {
    const chapter = await askPrompt('章节号', String(chapterNo ?? 1))
    if (!chapter) return
    const bookTime = await askPrompt('书中时间', '', { placeholder: '如：第三日清晨 / 天元历302年' })
    if (!bookTime) return
    const event = await askPrompt('发生了什么', '', { multiline: true })
    if (!event) return
    await run(async () => {
      await call('extras:recordTimeline', { projectId: projectId!, chapterNo: Number(chapter) || 1, bookTime, event })
      await load('timeline')
    }, '时间线已记录')
  }

  const consistencyAudit = async (): Promise<void> => {
    await run(async () => {
      const report = await call('extras:consistencyAudit', { projectId: projectId! })
      const lines = [
        ...report.conflicts.map((c) => `⚠ 冲突：${c.entity}.${c.field} → ${c.history.map((h) => h.value).join(' | ')}`),
        ...report.timelineIssues.map((t) => `⚠ 时间线：${t.message}`),
        ...report.sedimentSuggestions.map((s) => `💡 沉淀建议：${s.entity}（可固化为世界书条目）`),
      ]
      openRightPanel({
        kind: 'result',
        title: `一致性巡检：${lines.length === 0 ? '无异常' : `${lines.length} 项待关注`}`,
        text: lines.length > 0 ? lines.join('\n') : '账本、时间线、伏笔均无异常。',
      })
    })
  }

  const addLibrary = async (): Promise<void> => {
    const kind = await askSelect('素材类型', [{ value: 'material', label: '素材' }, { value: 'skill', label: '技能' }], 'material')
    if (!kind) return
    const title = await askPrompt('标题', '')
    if (!title) return
    const content = await askPrompt('内容', '', { multiline: true })
    if (!content) return
    await run(async () => {
      const now = new Date().toISOString()
      await call('library:save', {
        entry: { id: `lib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, kind: kind as 'material' | 'skill', title, content, tags: [], bookIds: [], createdAt: now, updatedAt: now },
      })
      await load('library')
    }, '素材已保存')
  }

  const editLibrary = async (item: LibraryEntry): Promise<void> => {
    const title = await askPrompt('标题', item.title)
    if (!title) return
    const content = await askPrompt('内容', item.content, { multiline: true })
    if (content === null) return
    await run(async () => {
      await call('library:save', { entry: { ...item, title, content, updatedAt: new Date().toISOString() } })
      await load('library')
    }, '已保存')
  }

  const deleteLibrary = async (item: LibraryEntry): Promise<void> => {
    const ok = await askConfirm('删除素材', `确定删除「${item.title}」吗？`, { confirmLabel: '删除', danger: true })
    if (!ok) return
    await run(async () => {
      await call('library:delete', { id: item.id })
      await load('library')
    }, '已删除')
  }

  return (
    <div className="panel-body">
      <div className="panel-actions">
        <button className="primary" onClick={() => void consistencyAudit()}>一致性巡检</button>
      </div>

      <div className="tab-strip">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      <div className="panel-list">
        {tab === 'foreshadow' && (
          <>
            <button className="add-row" onClick={() => void plantForeshadow()}><IconPlus size={13} /> 登记伏笔</button>
            {foreshadows.map((f) => (
              <div className="list-row slim" key={f.id}>
                <div className="chapter-info">
                  <div className="row-line-1"><strong>{FORESHADOW_STATUS[f.status] ?? f.status}</strong><span className="badge muted-badge">第 {f.plantChapter} 章</span></div>
                  <div className="row-line-2">{f.content}</div>
                </div>
                <div className="row-hover-actions">
                  {f.status === 'open' && <button className="icon-btn" title="回收" onClick={() => void revealForeshadow(f)}>✓</button>}
                  {f.status === 'open' && <button className="icon-btn danger" title="放弃" onClick={() => void dropForeshadow(f)}><IconTrash size={12} /></button>}
                </div>
              </div>
            ))}
            {foreshadows.length === 0 && <div className="panel-empty"><p className="muted">暂无伏笔记录</p></div>}
          </>
        )}

        {tab === 'glossary' && (
          <>
            <button className="add-row" onClick={() => void addGlossary()}><IconPlus size={13} /> 添加术语</button>
            <button className="add-row subtle" onClick={() => void extractGlossary()}>从当前正文提取候选</button>
            {glossary.map((g) => (
              <div className="list-row slim" key={g.term}>
                <div className="chapter-info">
                  <div className="row-line-1"><strong>{g.term}</strong></div>
                  <div className="row-line-2">{g.definition}</div>
                </div>
              </div>
            ))}
            {glossary.length === 0 && <div className="panel-empty"><p className="muted">暂无术语</p></div>}
          </>
        )}

        {tab === 'ideas' && (
          <>
            <button className="add-row" onClick={() => void addIdea()}><IconPlus size={13} /> 记录灵感</button>
            {ideas.map((i) => (
              <div className="list-row slim" key={i.id}>
                <div className="chapter-info"><div className="row-line-2">{i.content}</div></div>
              </div>
            ))}
            {ideas.length === 0 && <div className="panel-empty"><p className="muted">暂无灵感记录</p></div>}
          </>
        )}

        {tab === 'timeline' && (
          <>
            <button className="add-row" onClick={() => void recordTimeline()}><IconPlus size={13} /> 记录时间线</button>
            {timeline.map((t, i) => (
              <div className="list-row slim" key={i}>
                <div className="chapter-info">
                  <div className="row-line-1"><span className="badge muted-badge">第 {t.chapterNo} 章</span><strong>{t.bookTime}</strong></div>
                  <div className="row-line-2">{t.event}</div>
                </div>
              </div>
            ))}
            {timeline.length === 0 && <div className="panel-empty"><p className="muted">暂无时间线记录</p></div>}
          </>
        )}

        {tab === 'ledger' && (
          <>
            {ledger.map((e, i) => (
              <div className="list-row slim" key={i}>
                <div className="chapter-info">
                  <div className="row-line-1"><strong>{e.entity}.{e.field}</strong><span className="badge muted-badge">第 {e.chapterNo} 章</span></div>
                  <div className="row-line-2">{e.value}</div>
                </div>
              </div>
            ))}
            {ledger.length === 0 && <div className="panel-empty"><p className="muted">账本为空（保存章节时自动提取）</p></div>}
          </>
        )}

        {tab === 'library' && (
          <>
            <button className="add-row" onClick={() => void addLibrary()}><IconPlus size={13} /> 新增素材 / 技能</button>
            {library.map((item) => (
              <div className="list-row slim" key={item.id} onClick={() => void editLibrary(item)} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') void editLibrary(item) }}>
                <div className="chapter-info">
                  <div className="row-line-1"><strong>{item.title}</strong><span className="badge muted-badge">{item.kind === 'material' ? '素材' : '技能'}</span></div>
                  <div className="row-line-2">{item.content.length > 40 ? `${item.content.slice(0, 40)}…` : item.content}</div>
                </div>
                <div className="row-hover-actions">
                  <button className="icon-btn danger" title="删除" onClick={(e) => { e.stopPropagation(); void deleteLibrary(item) }}><IconTrash size={12} /></button>
                </div>
              </div>
            ))}
            {library.length === 0 && <div className="panel-empty"><p className="muted">素材库为空</p></div>}
          </>
        )}
      </div>
    </div>
  )
}
