/**
 * 创作流程面板 — 九阶段门禁可视化与产物管理。
 */
import { useEffect, useState } from 'react'
import { call } from '../../ipc'
import { useStore } from '../../store'
import { PHASE_LABELS } from '../../constants'
import type { PhaseId, PhaseState } from '@dafuyu/core/workflow'
import { PHASE_ORDER } from '@dafuyu/core/workflow'

const STATE_META: Record<PhaseState, { label: string; cls: string }> = {
  locked: { label: '未开始', cls: 'locked' },
  in_progress: { label: '进行中', cls: 'progress' },
  review: { label: '待复核', cls: 'review' },
  approved: { label: '已完成', cls: 'done' },
  skipped: { label: '已跳过', cls: 'skipped' },
}

export function WorkflowPanel(): JSX.Element {
  const projectId = useStore((s) => s.projectId)
  const askSelect = useStore((s) => s.askSelect)
  const askPrompt = useStore((s) => s.askPrompt)
  const askConfirm = useStore((s) => s.askConfirm)
  const run = useStore((s) => s.run)
  const notify = useStore((s) => s.notify)
  const showResult = useStore((s) => s.showResult)
  const auditLog = useStore((s) => s.auditLog)
  const cloneProject = useStore((s) => s.cloneProject)

  const [phases, setPhases] = useState<Record<string, { state: PhaseState; version: number }> | null>(null)
  const [artifacts, setArtifacts] = useState<Array<{ phase: string; content: string | null }>>([])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void (async () => {
      try {
        const [book, arts] = await Promise.all([
          call('projects:get', { id: projectId }),
          call('projects:listArtifacts', { id: projectId }),
        ])
        if (cancelled) return
        setPhases(book.phases as unknown as Record<string, { state: PhaseState; version: number }>)
        setArtifacts(arts)
      } catch {
        if (!cancelled) { setPhases(null); setArtifacts([]) }
      }
    })()
    return () => { cancelled = true }
  }, [projectId])

  const currentPhase = useStore((s) => s.book?.currentPhase ?? null)

  const refresh = async (): Promise<void> => {
    if (!projectId) return
    const [book, arts] = await Promise.all([
      call('projects:get', { id: projectId }),
      call('projects:listArtifacts', { id: projectId }),
    ])
    setPhases(book.phases as unknown as Record<string, { state: PhaseState; version: number }>)
    setArtifacts(arts)
    useStore.setState((s) => ({ book: s.book ? { ...s.book, currentPhase: book.currentPhase } : s.book }))
  }

  const enterPhase = async (): Promise<void> => {
    if (!projectId) return
    const idx = currentPhase ? PHASE_ORDER.indexOf(currentPhase as PhaseId) : -1
    const next = idx >= 0 && idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1]! : null
    const options = PHASE_ORDER.map((p) => ({
      value: p,
      label: PHASE_LABELS[p],
      hint: p === next ? '下一阶段' : undefined,
    }))
    const phase = await askSelect('进入阶段', options, next ?? undefined)
    if (!phase) return
    await run(async () => {
      await call('projects:phase', { projectId, phase: phase as PhaseId })
      await refresh()
      notify(`已进入「${PHASE_LABELS[phase as PhaseId]}」阶段`)
    })
  }

  const commitArtifact = async (): Promise<void> => {
    if (!projectId) return
    const options = PHASE_ORDER.filter((p) => p !== 'done').map((p) => ({ value: p, label: PHASE_LABELS[p] }))
    const phase = await askSelect('提交哪个阶段的产物？', options, currentPhase ?? undefined)
    if (!phase) return
    const existing = artifacts.find((a) => a.phase === phase)?.content ?? ''
    const artifact = await askPrompt(`「${PHASE_LABELS[phase as PhaseId]}」产物内容`, existing, { multiline: true, message: '将保存该阶段产物并标记为已完成（可回退）' })
    if (artifact == null) return
    await run(async () => {
      await call('projects:commit', { projectId, phase: phase as PhaseId, artifact })
      await refresh()
      notify(`「${PHASE_LABELS[phase as PhaseId]}」已提交`)
    })
  }

  const rollback = async (): Promise<void> => {
    if (!projectId || !currentPhase) return
    const options = PHASE_ORDER.map((p) => ({ value: p, label: PHASE_LABELS[p] }))
    const phase = await askSelect('回退哪个阶段？', options, currentPhase)
    if (!phase) return
    const ok = await askConfirm('回退阶段', `确定将「${PHASE_LABELS[phase as PhaseId]}」回退为进行中吗？`, { confirmLabel: '回退', danger: true })
    if (!ok) return
    await run(async () => {
      await call('projects:override', { projectId, phase: phase as PhaseId, action: 'rollback' })
      await refresh()
      notify(`「${PHASE_LABELS[phase as PhaseId]}」已回退`)
    })
  }

  const viewArtifact = async (phase: string): Promise<void> => {
    const content = artifacts.find((a) => a.phase === phase)?.content
    await showResult(`「${PHASE_LABELS[phase as PhaseId] ?? phase}」产物`, content?.trim() || '（暂无内容）')
  }

  return (
    <div className="panel-body">
      <div className="panel-actions">
        <button className="primary" onClick={() => void enterPhase()}>进入阶段</button>
        <button onClick={() => void commitArtifact()}>提交产物</button>
        <button onClick={() => void rollback()}>回退</button>
      </div>

      <div className="panel-section">
        <div className="panel-section-head"><span>九阶段进度</span></div>
        <div className="phase-track">
          {PHASE_ORDER.map((p, i) => {
            const state = phases?.[p]?.state ?? 'locked'
            const meta = STATE_META[state]
            const isCurrent = currentPhase === p
            return (
              <div key={p} className={`phase-step ${meta.cls} ${isCurrent ? 'current' : ''}`}>
                <span className="phase-dot">{state === 'approved' ? '✓' : state === 'skipped' ? '–' : i + 1}</span>
                <span className="phase-name">{PHASE_LABELS[p]}</span>
                <span className="phase-state">{isCurrent ? '当前' : meta.label}</span>
              </div>
            )
          })}
        </div>
        {phases === null && <div className="panel-empty"><p className="muted">暂无流程数据</p></div>}
      </div>

      <div className="panel-section">
        <div className="panel-section-head"><span>阶段产物</span></div>
        {artifacts.map((a) => (
          <button key={a.phase} className="list-row slim artifact-row" onClick={() => void viewArtifact(a.phase)}>
            <span className="phase-name">{PHASE_LABELS[a.phase as PhaseId] ?? a.phase}</span>
            <span className={`badge ${a.content?.trim() ? '' : 'muted-badge'}`}>{a.content?.trim() ? `${a.content.length} 字` : '空'}</span>
          </button>
        ))}
        {artifacts.length === 0 && <div className="panel-empty"><p className="muted">暂无产物</p></div>}
      </div>

      <div className="panel-footnote row-gap">
        <button className="link-btn" onClick={() => void auditLog()}>审计日志</button>
        <button className="link-btn" onClick={() => void cloneProject()}>克隆作品</button>
      </div>
    </div>
  )
}
