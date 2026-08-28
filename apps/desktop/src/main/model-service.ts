/**
 * ModelService — 模型配置与调用（主进程）。
 * 密钥只保存在主进程侧（settings.json），渲染进程仅能引用 profile id。
 * 支持 OpenAI 兼容 / Anthropic / Google Gemini 三类端点。
 */
import type { ModelProfile } from '@dafuyu/contracts'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CompleteOptions {
  temperature?: number
  maxTokens?: number
}

export interface ModelServiceDeps {
  loadSettings: () => Promise<Record<string, unknown>>
  saveSettings: (settings: Record<string, unknown>) => Promise<void>
}

function settingsProfiles(settings: Record<string, unknown>): ModelProfile[] {
  const raw = settings.modelProfiles
  return Array.isArray(raw) ? raw as ModelProfile[] : []
}

export class ModelService {
  constructor(private readonly deps: ModelServiceDeps) {}

  async list(): Promise<ModelProfile[]> {
    return settingsProfiles(await this.deps.loadSettings())
  }

  async save(profile: ModelProfile): Promise<ModelProfile> {
    const settings = await this.deps.loadSettings()
    const profiles = settingsProfiles(settings)
    const index = profiles.findIndex((p) => p.id === profile.id)
    if (index >= 0) profiles[index] = profile
    else profiles.push(profile)
    await this.deps.saveSettings({ ...settings, modelProfiles: profiles })
    return profile
  }

  async delete(id: string): Promise<void> {
    const settings = await this.deps.loadSettings()
    const profiles = settingsProfiles(settings).filter((p) => p.id !== id)
    await this.deps.saveSettings({ ...settings, modelProfiles: profiles })
  }

  async get(id?: string): Promise<ModelProfile | null> {
    const profiles = await this.list()
    if (id) return profiles.find((p) => p.id === id) ?? null
    return profiles.find((p) => p.enabled) ?? profiles[0] ?? null
  }

  async complete(profileId: string | undefined, messages: ChatMessage[], options: CompleteOptions = {}): Promise<{ text: string; model: string; provider: string }> {
    const profile = await this.get(profileId)
    if (!profile) throw new Error('未配置可用模型，请先在设置中添加模型服务')
    if (!profile.apiKey) throw new Error(`模型「${profile.name}」缺少 API Key`)

    if (profile.provider === 'anthropic') {
      return await this.completeAnthropic(profile, messages, options)
    }
    if (profile.provider === 'google') {
      return await this.completeGoogle(profile, messages, options)
    }
    return await this.completeOpenAICompatible(profile, messages, options)
  }

  async fetchModels(provider: ModelProfile['provider'], baseUrl?: string, apiKey?: string): Promise<{ models: string[]; error?: string }> {
    try {
      if (provider === 'google') {
        const base = (baseUrl ?? '').trim().replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com/v1beta'
        const url = `${base}/models?key=${encodeURIComponent(apiKey ?? '')}`
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json() as { models?: Array<{ name?: string }> }
        const models = (data.models ?? [])
          .map((m) => m.name ?? '')
          .filter((n) => n.includes('/'))
          .map((n) => n.slice(n.lastIndexOf('/') + 1))
          .filter(Boolean)
        return { models }
      }
      if (provider === 'anthropic') {
        return { models: [], error: 'Anthropic 暂不支持自动获取模型列表，请手动填写模型名（如 claude-sonnet-4-20250514）' }
      }
      const base = (baseUrl ?? '').trim().replace(/\/+$/, '') || 'https://api.openai.com/v1'
      const response = await fetch(`${base}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
      }
      const data = await response.json() as { data?: Array<{ id?: string }> }
      return { models: (data.data ?? []).map((m) => m.id ?? '').filter(Boolean).sort() }
    } catch (error) {
      return { models: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  async test(profileId: string): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const started = Date.now()
    try {
      const result = await this.complete(profileId, [
        { role: 'user', content: '请回复“正常”两个字。' },
      ], { maxTokens: 128 })
      return { ok: true, message: `连通成功：${result.model}（${result.provider}）`, latencyMs: Date.now() - started }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - started }
    }
  }

  private baseUrl(profile: ModelProfile): string {
    return (profile.baseUrl ?? '').trim().replace(/\/+$/, '')
  }

  private async completeOpenAICompatible(profile: ModelProfile, messages: ChatMessage[], options: CompleteOptions): Promise<{ text: string; model: string; provider: string }> {
    const base = this.baseUrl(profile) || 'https://api.openai.com/v1'
    const url = `${base}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${profile.apiKey}`,
      },
      body: JSON.stringify({
        model: profile.model,
        messages,
        temperature: options.temperature ?? profile.temperature ?? 0.8,
        max_tokens: options.maxTokens ?? profile.maxTokens ?? 4096,
      }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`模型请求失败 ${response.status}: ${text.slice(0, 300)}`)
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
    if (data.error?.message) throw new Error(data.error.message)
    const text = data.choices?.[0]?.message?.content
    if (!text) throw new Error('模型返回内容为空')
    return { text, model: profile.model, provider: profile.provider }
  }

  private async completeAnthropic(profile: ModelProfile, messages: ChatMessage[], options: CompleteOptions): Promise<{ text: string; model: string; provider: string }> {
    const base = this.baseUrl(profile) || 'https://api.anthropic.com/v1'
    const url = `${base}/messages`
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
    const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }))
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': profile.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: profile.model,
        ...(system ? { system } : {}),
        messages: rest,
        temperature: options.temperature ?? profile.temperature ?? 0.8,
        max_tokens: options.maxTokens ?? profile.maxTokens ?? 4096,
      }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Anthropic 请求失败 ${response.status}: ${text.slice(0, 300)}`)
    }
    const data = await response.json() as { content?: Array<{ type?: string; text?: string }>; error?: { message?: string } }
    if (data.error?.message) throw new Error(data.error.message)
    const text = data.content?.find((c) => c.type === 'text')?.text
    if (!text) throw new Error('Anthropic 返回内容为空')
    return { text, model: profile.model, provider: profile.provider }
  }

  private async completeGoogle(profile: ModelProfile, messages: ChatMessage[], options: CompleteOptions): Promise<{ text: string; model: string; provider: string }> {
    const base = this.baseUrl(profile) || 'https://generativelanguage.googleapis.com/v1beta'
    const url = `${base}/models/${profile.model}:generateContent`
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const system = messages.find((m) => m.role === 'system')?.content
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': profile.apiKey! },
      body: JSON.stringify({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          temperature: options.temperature ?? profile.temperature ?? 0.8,
          maxOutputTokens: options.maxTokens ?? profile.maxTokens ?? 4096,
        },
      }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Gemini 请求失败 ${response.status}: ${text.slice(0, 300)}`)
    }
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } }
    if (data.error?.message) throw new Error(data.error.message)
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
    if (!text) throw new Error('Gemini 返回内容为空')
    return { text, model: profile.model, provider: profile.provider }
  }
}
