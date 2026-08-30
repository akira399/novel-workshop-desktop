/**
 * 应用设置 — 外观 / 编辑 / 数据 / 云同步 / 关于与更新。
 */
import { useEffect, useState } from 'react'
import type { AppSettings } from '@dafuyu/contracts'
import { call } from '../ipc'
import { useStore } from '../store'
import { IconX } from './Icons'

type UpdateState = { status: 'idle' | 'checking' | 'available' | 'not-available' | 'error'; version?: string; message?: string }

const AUTO_SAVE_OPTIONS = [
  { value: '1000', label: '每 1 秒' },
  { value: '1500', label: '每 1.5 秒' },
  { value: '3000', label: '每 3 秒' },
  { value: '0', label: '关闭（仅手动保存）' },
]

export function AppSettingsModal(): JSX.Element | null {
  const show = useStore((s) => s.showAppSettings)
  const close = useStore((s) => s.closeAppSettings)
  const settings = useStore((s) => s.settings)
  const info = useStore((s) => s.info)
  const workspacePath = useStore((s) => s.workspace?.path ?? null)
  const setTheme = useStore((s) => s.setTheme)
  const chooseWorkspace = useStore((s) => s.chooseWorkspace)
  const run = useStore((s) => s.run)
  const notify = useStore((s) => s.notify)
  const fail = useStore((s) => s.fail)

  const [autoSaveMs, setAutoSaveMs] = useState(String(typeof settings.autoSaveMs === 'number' ? settings.autoSaveMs : 1500))
  const [sync, setSync] = useState<{ configured: boolean; url: string; username: string; password: string; remotePath: string; lastSyncAt?: string }>({
    configured: false, url: '', username: '', password: '', remotePath: 'novel-workshop-backup.zip',
  })
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })

  useEffect(() => {
    if (!show) return
    void (async () => {
      try {
        const status = await call('sync:status', undefined)
        setSync((s) => ({
          ...s,
          configured: status.configured,
          url: status.url ?? '',
          remotePath: status.remotePath ?? s.remotePath,
          lastSyncAt: status.lastSyncAt,
        }))
      } catch { /* 未配置时静默 */ }
    })()
  }, [show])

  if (!show) return null

  const persistAutoSave = async (value: string): Promise<void> => {
    setAutoSaveMs(value)
    const ms = Number(value)
    await call('settings:set', { settings: { autoSaveMs: ms > 0 ? ms : 0 } }).catch(() => undefined)
    notify(value === '0' ? '自动保存已关闭' : '自动保存设置已更新')
  }

  const saveSyncConfig = async (): Promise<void> => {
    if (!sync.url.trim()) { fail('请填写 WebDAV 地址'); return }
    await run(async () => {
      await call('sync:saveConfig', {
        config: { url: sync.url.trim(), username: sync.username.trim(), password: sync.password, remotePath: sync.remotePath.trim() || undefined },
      })
      const status = await call('sync:status', undefined)
      setSync((s) => ({ ...s, configured: status.configured, lastSyncAt: status.lastSyncAt }))
    }, '同步配置已保存')
  }

  const testSync = async (): Promise<void> => {
    await run(async () => {
      const result = await call('sync:test', undefined)
      if (result.ok) notify(`连接成功：${result.message}`)
      else fail(`连接失败：${result.message}`)
    })
  }

  const pushSync = async (): Promise<void> => {
    await run(async () => {
      const result = await call('sync:push', undefined)
      const status = await call('sync:status', undefined)
      setSync((s) => ({ ...s, lastSyncAt: status.lastSyncAt }))
      notify(result.message || '已推送到云端')
    })
  }

  const pullSync = async (): Promise<void> => {
    const ok = await useStore.getState().askConfirm('从云端拉取', '将用云端备份覆盖本地工作区数据，确定继续吗？', { confirmLabel: '拉取', danger: true })
    if (!ok) return
    await run(async () => {
      const result = await call('sync:pull', undefined)
      notify(result.message || '已从云端拉取')
      await useStore.getState().refreshWorkspace()
    })
  }

  const checkUpdate = async (): Promise<void> => {
    setUpdate({ status: 'checking' })
    await run(async () => {
      const result = await call('update:check', undefined)
      setUpdate(result)
      if (result.status === 'available') notify(`发现新版本 v${result.version}`)
    })
  }

  const downloadUpdate = async (): Promise<void> => {
    await run(async () => {
      await call('update:download', undefined)
      notify('正在后台下载更新，完成后会提示安装')
    })
  }

  const themeValue = settings.theme ?? 'light'

  return (
    <div className="modal-mask" onClick={close}>
      <div className="modal dialog-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title bar">
          设置
          <button className="icon-btn" onClick={close} title="关闭"><IconX size={15} /></button>
        </div>

        <div className="modal-form">
          <div className="form-section">
            <div className="form-section-title">外观</div>
            <div className="field-row">
              <button className={themeValue === 'light' ? 'primary' : ''} onClick={() => void setTheme('light')}>浅色</button>
              <button className={themeValue === 'dark' ? 'primary' : ''} onClick={() => void setTheme('dark')}>深色</button>
              <button className={themeValue === 'system' ? 'primary' : ''} onClick={() => void setTheme('system')}>跟随系统</button>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">编辑</div>
            <label className="field narrow">
              <span>自动保存</span>
              <select value={autoSaveMs} onChange={(e) => void persistAutoSave(e.target.value)}>
                {AUTO_SAVE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>

          <div className="form-section">
            <div className="form-section-title">数据</div>
            <div className="field">
              <span>工作区目录（所有作品保存在这里）</span>
              <div className="field-row">
                <input value={workspacePath ?? '未选择'} readOnly className="flex-1" />
                <button onClick={() => void chooseWorkspace()}>更换目录</button>
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">云同步（WebDAV）</div>
            <div className="field-row">
              <label className="field flex-1">
                <span>服务器地址</span>
                <input value={sync.url} onChange={(e) => setSync({ ...sync, url: e.target.value })} placeholder="https://dav.jianguoyun.com/dav/" />
              </label>
              <label className="field flex-1">
                <span>账号</span>
                <input value={sync.username} onChange={(e) => setSync({ ...sync, username: e.target.value })} placeholder="user@example.com" />
              </label>
            </div>
            <div className="field-row">
              <label className="field flex-1">
                <span>应用密码</span>
                <input type="password" value={sync.password} onChange={(e) => setSync({ ...sync, password: e.target.value })} placeholder={sync.configured ? '已保存（输入可覆盖）' : '应用密码 / 授权码'} />
              </label>
              <label className="field flex-1">
                <span>远端文件名</span>
                <input value={sync.remotePath} onChange={(e) => setSync({ ...sync, remotePath: e.target.value })} placeholder="novel-workshop-backup.zip" />
              </label>
            </div>
            <div className="field-row">
              <button onClick={() => void saveSyncConfig()}>保存配置</button>
              <button onClick={() => void testSync()} disabled={!sync.configured}>测试连接</button>
              <button className="primary" onClick={() => void pushSync()} disabled={!sync.configured}>推送到云端</button>
              <button onClick={() => void pullSync()} disabled={!sync.configured}>拉取云端</button>
            </div>
            <div className="muted small">
              {sync.lastSyncAt ? `上次同步：${sync.lastSyncAt.slice(0, 19).replace('T', ' ')}` : '尚未同步'} · 兼容坚果云 / Nextcloud / 自建 WebDAV
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">关于</div>
            <div className="field-row">
              <span className="muted small">大肥鱼的小说工坊 v{info?.version ?? '—'}</span>
              <span className="flex-spacer" />
              {update.status === 'available'
                ? <button className="primary" onClick={() => void downloadUpdate()}>下载 v{update.version}</button>
                : <button disabled={update.status === 'checking'} onClick={() => void checkUpdate()}>{update.status === 'checking' ? '检查中…' : '检查更新'}</button>}
            </div>
            {update.message && <div className="muted small">{update.message}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
