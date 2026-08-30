/**
 * 顶栏 — 品牌、工作区、全局入口与窗口控制（可拖拽移动窗口）。
 */
import { useStore } from '../store'
import { IconMoon, IconSun, IconWinClose, IconWinMaximize, IconWinMinimize } from './Icons'

export function TopBar(): JSX.Element {
  const info = useStore((s) => s.info)
  const workspace = useStore((s) => s.workspace)
  const chooseWorkspace = useStore((s) => s.chooseWorkspace)
  const openReader = useStore((s) => s.openReader)
  const openModelSettings = useStore((s) => s.openModelSettings)
  const openAppSettings = useStore((s) => s.openAppSettings)
  const theme = useStore((s) => s.settings.theme)
  const setTheme = useStore((s) => s.setTheme)

  const resolvedDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">坊</div>
        <strong>大肥鱼的小说工坊</strong>
        {info?.version && <span className="version-badge">v{info.version}</span>}
      </div>
      <div className="topbar-drag" />
      <div className="top-actions">
        <button className="ghost" onClick={() => void chooseWorkspace()} title={workspace?.path ?? ''}>
          {workspace ? `工作区 · ${workspace.bookCount} 部作品` : '选择工作区'}
        </button>
        <div className="v-divider" />
        <button className="ghost" onClick={() => void openReader()}>本地阅读</button>
        <button className="ghost" onClick={openModelSettings}>模型设置</button>
        <button
          className="icon-btn"
          title={resolvedDark ? '切换为浅色' : '切换为深色'}
          onClick={() => void setTheme(resolvedDark ? 'light' : 'dark')}
        >
          {resolvedDark ? <IconSun size={15} /> : <IconMoon size={14} />}
        </button>
        <button className="ghost" onClick={openAppSettings}>设置</button>
      </div>
      <div className="window-controls">
        <button className="win-btn" onClick={() => window.novelWorkshop.minimize()} title="最小化"><IconWinMinimize size={13} /></button>
        <button className="win-btn" onClick={() => window.novelWorkshop.maximize()} title="最大化 / 还原"><IconWinMaximize size={12} /></button>
        <button className="win-btn win-close" onClick={() => window.novelWorkshop.close()} title="关闭"><IconWinClose size={13} /></button>
      </div>
    </header>
  )
}
