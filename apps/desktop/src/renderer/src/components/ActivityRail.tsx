/**
 * 左侧图标导航 — 切换侧栏面板。
 */
import type { PanelKey } from '../store'
import { useStore } from '../store'
import { IconBook, IconFlag, IconGlobe, IconLayers, IconList, IconTool } from './Icons'

const ITEMS: Array<{ key: PanelKey; label: string; needsProject?: boolean; icon: (active: boolean) => JSX.Element }> = [
  { key: 'projects', label: '作品库', icon: () => <IconBook size={19} /> },
  { key: 'chapters', label: '章节', needsProject: true, icon: () => <IconList size={19} /> },
  { key: 'lorebook', label: '世界书', icon: () => <IconGlobe size={19} /> },
  { key: 'workflow', label: '创作流程', needsProject: true, icon: () => <IconFlag size={19} /> },
  { key: 'data', label: '资料库', needsProject: true, icon: () => <IconLayers size={19} /> },
  { key: 'toolbox', label: '工具箱', needsProject: true, icon: () => <IconTool size={19} /> },
]

export function ActivityRail(): JSX.Element {
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const hasProject = useStore((s) => s.projectId !== null)

  return (
    <nav className="activity-rail">
      {ITEMS.map((item) => {
        const disabled = item.needsProject === true && !hasProject
        const active = panel === item.key
        return (
          <button
            key={item.key}
            className={`rail-btn ${active ? 'active' : ''}`}
            disabled={disabled}
            title={disabled ? `${item.label}（请先选择作品）` : item.label}
            onClick={() => setPanel(item.key)}
          >
            {item.icon(active)}
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
