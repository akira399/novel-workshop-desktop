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

export interface StreamResult {
  text: string
  model: string
  provider: string
  aborted: boolean
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
  private readonly streamControllers = new Map<string, AbortController>()

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

  /** 中止进行中的流式请求。返回是否找到并中止了该 op。 */
  abortStream(opId: string): boolean {
    const controller = this.streamControllers.get(opId)
    if (!controller) return false
    controller.abort()
    return true
  }

  /**
   * 流式补全：增量经 onDelta 回调抛给调用方（由主进程转发渲染层）。
   * 返回完整文本；用户中止时 aborted=true 且返回已累积的部分文本。
   */
  async streamComplete(opId: string, profileId: string | undefined, messages: ChatMessage[], options: CompleteOptions, onDelta: (delta: string) => void): Promise<StreamResult> {
    const profile = await this.get(profileId)
    if (!profile) throw new Error('未配置可用模型，请先在设置中添加模型服务')
    if (!profile.apiKey) throw new Error(`模型「${profile.name}」缺少 API Key`)

    const controller = new AbortController()
    this.streamControllers.set(opId, controller)
    try {
      if (profile.provider === 'anthropic') {
        return await this.streamAnthropic(profile, messages, options, controller.signal, onDelta)
      }
      if (profile.provider === 'google') {
        return await this.streamGoogle(profile, messages, options, controller.signal, onDelta)
      }
      return await this.streamOpenAICompatible(profile, messages, options, controller.signal, onDelta)
    } finally {
      this.streamControllers.delete(opId)
    }
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
        { role: 'system', content: '你是连接测试助手。' },
        { role: 'user', content: '请回复“正常”两个字。' },
      ], { maxTokens: 2048 })
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

  // ── 流式补全（SSE） ──

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'AbortError' || error.message.includes('abort'))
  }

  /** 解析 SSE 响应体，逐产出 data: 载荷行（自动处理分块截断）。 */
  private async readSseData(response: Response, onPayload: (payload: string) => void): Promise<void> {
    const body = response.body
    if (!body) throw new Error('响应无内容流')
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIdx = buffer.indexOf('\n')
      while (newlineIdx >= 0) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '')
        buffer = buffer.slice(newlineIdx + 1)
        if (line.startsWith('data:')) onPayload(line.slice(5).trim())
        newlineIdx = buffer.indexOf('\n')
      }
    }
    const rest = buffer.trim()
    if (rest.startsWith('data:')) onPayload(rest.slice(5).trim())
  }

  private async streamOpenAICompatible(profile: ModelProfile, messages: ChatMessage[], options: CompleteOptions, signal: AbortSignal, onDelta: (delta: string) => void): Promise<StreamResult> {
    const base = this.baseUrl(profile) || 'https://api.openai.com/v1'
    let text = ''
    let aborted = false
    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${profile.apiKey}`,
        },
        body: JSON.stringify({
          model: profile.model,
          messages,
          stream: true,
          temperature: options.temperature ?? profile.temperature ?? 0.8,
          max_tokens: options.maxTokens ?? profile.maxTokens ?? 4096,
        }),
      })
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`模型请求失败 ${response.status}: ${errorText.slice(0, 300)}`)
      }
      await this.readSseData(response, (payload) => {
        if (!payload || payload === '[DONE]') return
        try {
          const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            text += delta
            onDelta(delta)
          }
        } catch { // 忽略无法解析的心跳/注释行
        }
      })
    } catch (error) {
      if (!this.isAbortError(error)) throw error
      aborted = true
    }
    return { text, model: profile.model, provider: profile.provider, aborted }
  }

  private async streamAnthropic(profile: ModelProfile, messages: ChatMessage[], options: CompleteOptions, signal: AbortSignal, onDelta: (delta: string) => void): Promise<StreamResult> {
    const base = this.baseUrl(profile) || 'https://api.anthropic.com/v1'
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
    const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }))
    let text = ''
    let aborted = false
    try {
      const response = await fetch(`${base}/messages`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': profile.apiKey!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: profile.model,
          ...(system ? { system } : {}),
          messages: rest,
          stream: true,
          temperature: options.temperature ?? profile.temperature ?? 0.8,
          max_tokens: options.maxTokens ?? profile.maxTokens ?? 4096,
        }),
      })
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`Anthropic 请求失败 ${response.status}: ${errorText.slice(0, 300)}`)
      }
      await this.readSseData(response, (payload) => {
        if (!payload) return
        try {
          const json = JSON.parse(payload) as { type?: string; delta?: { text?: string } }
          if (json.type === 'content_block_delta' && json.delta?.text) {
            text += json.delta.text
            onDelta(json.delta.text)
          }
        } catch { // 忽略无法解析的事件行
        }
      })
    } catch (error) {
      if (!this.isAbortError(error)) throw error
      aborted = true
    }
    return { text, model: profile.model, provider: profile.provider, aborted }
  }

  private async streamGoogle(profile: ModelProfile, messages: ChatMessage[], options: CompleteOptions, signal: AbortSignal, onDelta: (delta: string) => void): Promise<StreamResult> {
    const base = this.baseUrl(profile) || 'https://generativelanguage.googleapis.com/v1beta'
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const system = messages.find((m) => m.role === 'system')?.content
    let text = ''
    let aborted = false
    try {
      const response = await fetch(`${base}/models/${profile.model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        signal,
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
        const errorText = await response.text().catch(() => '')
        throw new Error(`Gemini 请求失败 ${response.status}: ${errorText.slice(0, 300)}`)
      }
      await this.readSseData(response, (payload) => {
        if (!payload) return
        try {
          const json = JSON.parse(payload) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
          const delta = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
          if (delta) {
            text += delta
            onDelta(delta)
          }
        } catch { // 忽略无法解析的事件行
        }
      })
    } catch (error) {
      if (!this.isAbortError(error)) throw error
      aborted = true
    }
    return { text, model: profile.model, provider: profile.provider, aborted }
  }
}
