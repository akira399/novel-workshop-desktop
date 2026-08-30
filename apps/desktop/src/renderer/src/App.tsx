/**
 * App — 布局外壳：顶栏 / 图标导航 + 侧栏面板 / 中央编辑区 / 右栏 / 底部聊天栏。
 * 全部业务动作在 store.ts，组件只做渲染与交互转发。
 */
import { useEffect } from 'react'
import { useStore } from './store'
import { TopBar } from './components/TopBar'
import { ActivityRail } from './components/ActivityRail'
import { EditorArea } from './components/EditorArea'
import { ChatBar } from './components/ChatBar'
import { RightPanel } from './components/RightPanel'
import { DialogHost } from './components/Dialogs'
import { ModelSettingsModal } from './components/ModelSettingsModal'
import { LoreEditorModal } from './components/LoreEditorModal'
import { ReaderModal } from './components/ReaderModal'
import { ProjectsPanel } from './components/panels/ProjectsPanel'
import { ChaptersPanel } from './components/panels/ChaptersPanel'
import { LorebookPanel } from './components/panels/LorebookPanel'
import { WorkflowPanel } from './components/panels/WorkflowPanel'
import { DataPanel } from './components/panels/DataPanel'
import { ToolboxPanel } from './components/panels/ToolboxPanel'
import { IconX } from './components/Icons'

function SidePanel(): JSX.Element {
  const panel = useStore((s) => s.panel)
  switch (panel) {
    case 'projects': return <ProjectsPanel />
    case 'chapters': return <ChaptersPanel />
    case 'lorebook': return <LorebookPanel />
    case 'workflow': return <WorkflowPanel />
    case 'data': return <DataPanel />
    case 'toolbox': return <ToolboxPanel />
  }
}

function Toasts(): JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          <span>{t.text}</span>
          <IconX size={13} />
        </div>
      ))}
    </div>
  )
}

export function App(): JSX.Element {
  const boot = useStore((s) => s.boot)
  const panel = useStore((s) => s.panel)
  const hasProject = useStore((s) => s.projectId !== null)
  const saveChapter = useStore((s) => s.saveChapter)

  useEffect(() => { void boot() }, [boot])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveChapter(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveChapter])

  // 无作品时强制回到作品库面板（章节/流程/资料依赖作品）
  useEffect(() => {
    if (!hasProject && (panel === 'chapters' || panel === 'workflow' || panel === 'data' || panel === 'toolbox')) {
      useStore.getState().setPanel('projects')
    }
  }, [hasProject, panel])

  const startSideResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--side-w')) || 292
    const move = (ev: PointerEvent): void => {
      const w = Math.min(460, Math.max(232, startW + (ev.clientX - startX)))
      document.documentElement.style.setProperty('--side-w', `${w}px`)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="app">
      <TopBar />
      <div className="workbench">
        <ActivityRail />
        <div className="side-wrap">
          <section className="side-panel" key={panel}>
            <SidePanel />
          </section>
          <div className="panel-resizer" onPointerDown={startSideResize} />
        </div>
        <EditorArea />
        <RightPanel />
      </div>
      <ChatBar />

      <Toasts />
      <DialogHost />
      <ModelSettingsModal />
      <LoreEditorModal />
      <ReaderModal />
    </div>
  )
}
