/**
 * 模型设置 — 已保存模型管理与批量接入。
 */
import { useStore } from '../store'
import { PROVIDER_PRESETS } from '../constants'
import { IconX } from './Icons'

export function ModelSettingsModal(): JSX.Element | null {
  const show = useStore((s) => s.showModelSettings)
  const close = useStore((s) => s.closeModelSettings)
  const models = useStore((s) => s.models)
  const activeModelId = useStore((s) => s.activeModelId)
  const setActiveModel = useStore((s) => s.setActiveModel)
  const deleteModel = useStore((s) => s.deleteModel)
  const testModel = useStore((s) => s.testModel)
  const testingModelId = useStore((s) => s.testingModelId)
  const batchProvider = useStore((s) => s.batchProvider)
  const batchBaseUrl = useStore((s) => s.batchBaseUrl)
  const batchApiKey = useStore((s) => s.batchApiKey)
  const batchModelNames = useStore((s) => s.batchModelNames)
  const remoteModels = useStore((s) => s.remoteModels)
  const selectedRemoteModels = useStore((s) => s.selectedRemoteModels)
  const fetchingModels = useStore((s) => s.fetchingModels)
  const setBatch = useStore((s) => s.setBatch)
  const fetchRemoteModels = useStore((s) => s.fetchRemoteModels)
  const saveBatchModels = useStore((s) => s.saveBatchModels)
  const busy = useStore((s) => s.busy)

  if (!show) return null

  const manualCount = batchModelNames.split(/[\n,，]/).filter((s) => s.trim()).length
  const canSave = selectedRemoteModels.length + manualCount > 0

  const toggleRemote = (name: string): void => {
    setBatch({
      selectedRemoteModels: selectedRemoteModels.includes(name)
        ? selectedRemoteModels.filter((n) => n !== name)
        : [...selectedRemoteModels, name],
    })
  }

  return (
    <div className="modal-mask" onClick={close}>
      <div className="modal dialog-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title bar">
          模型设置
          <button className="icon-btn" onClick={close} title="关闭"><IconX size={15} /></button>
        </div>

        <div className="modal-form">
          <div className="form-section">
            <div className="form-section-title">已保存模型（{models.length}）</div>
            {models.map((m) => (
              <div className={`model-item ${m.id === activeModelId ? 'current' : ''}`} key={m.id}>
                <div className="model-item-info">
                  <div className="row-line-1">
                    <strong>{m.name}</strong>
                    {m.id === activeModelId && <span className="badge">当前使用</span>}
                  </div>
                  <div className="row-line-2">{m.model} · {PROVIDER_PRESETS.find((p) => p.id === m.provider)?.label ?? m.provider}</div>
                </div>
                <div className="model-item-actions">
                  {m.id !== activeModelId && <button onClick={() => setActiveModel(m.id)}>设为当前</button>}
                  <button disabled={testingModelId === m.id} onClick={() => void testModel(m.id)}>{testingModelId === m.id ? '测试中…' : '测试'}</button>
                  <button className="danger-ghost" onClick={() => void deleteModel(m.id)}>删除</button>
                </div>
              </div>
            ))}
            {models.length === 0 && <div className="form-empty">还没有模型，在下方接入即可开始 AI 创作</div>}
          </div>

          <div className="form-section">
            <div className="form-section-title">接入模型服务</div>
            <label className="field">
              <span>提供方</span>
              <select
                value={batchProvider}
                onChange={(e) => {
                  const provider = e.target.value as typeof batchProvider
                  const preset = PROVIDER_PRESETS.find((p) => p.id === provider)
                  setBatch({ batchProvider: provider, ...(preset ? { batchBaseUrl: preset.baseUrl } : {}) })
                }}
              >
                {PROVIDER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Base URL</span>
              <input value={batchBaseUrl} onChange={(e) => setBatch({ batchBaseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
            </label>
            <label className="field">
              <span>API Key</span>
              <input type="password" value={batchApiKey} onChange={(e) => setBatch({ batchApiKey: e.target.value })} placeholder="仅保存在本机" />
            </label>
            <div className="field-row">
              <button disabled={fetchingModels || !batchApiKey} onClick={() => void fetchRemoteModels()}>
                {fetchingModels ? '获取中…' : '自动获取模型列表'}
              </button>
              <span className="muted small">Key 只存储在本地，不会上传</span>
            </div>

            {remoteModels.length > 0 && (
              <div className="remote-model-list">
                {remoteModels.map((name) => (
                  <label key={name} className={`remote-model ${selectedRemoteModels.includes(name) ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedRemoteModels.includes(name)}
                      onChange={() => toggleRemote(name)}
                    />
                    {name}
                  </label>
                ))}
              </div>
            )}

            <label className="field">
              <span>或手动输入模型名（逗号 / 换行分隔）</span>
              <input value={batchModelNames} onChange={(e) => setBatch({ batchModelNames: e.target.value })} placeholder="deepseek-chat, deepseek-reasoner" />
            </label>

            <div className="field-row">
              <button className="primary" disabled={busy || !canSave} onClick={() => void saveBatchModels()}>
                保存所选模型{selectedRemoteModels.length + manualCount > 0 ? `（${selectedRemoteModels.length + manualCount} 个）` : ''}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
