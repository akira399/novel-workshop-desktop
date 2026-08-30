/**
 * AgentService — 主进程内的 AI 创作动作。
 * 组合 core 上下文/模板 + ModelService，向渲染进程提供写章/润色/去味/文风/修订。
 * 密钥不离开主进程。
 * 所有创作用户可选择模型：渲染进程传入当前 activeModelId（profileId）。
 */
import { join } from 'node:path'
import { loadPromptLibrary, renderPromptTemplate } from '@dafuyu/core/prompts'
import { buildWritePrompt } from '@dafuyu/core/write-prompt'
import { splitPolishSuggestions, applyPolishSuggestions } from '@dafuyu/core/polish'
import { buildRevisionResult } from '@dafuyu/core/revision'
import type { RevisionMode } from '@dafuyu/core/revision'
import type { PolishSuggestion } from '@dafuyu/core/polish'
import type { PromptTemplate } from '@dafuyu/core/types'
import { ModelService, type ChatMessage } from './model-service.ts'
import { WorkspaceService } from './workspace-service.ts'

export interface AgentServiceDeps {
  model: ModelService
  workspace: WorkspaceService
  resourcesDir: string
}

/** 流式调用选项：opId + onDelta 同时提供时走流式补全。 */
export interface AgentStreamOptions {
  opId?: string
  onDelta?: (delta: string) => void
}

export class AgentService {
  constructor(private readonly deps: AgentServiceDeps) {}

  private async template(id: string): Promise<PromptTemplate> {
    const templates = await loadPromptLibrary(join(this.deps.resourcesDir, 'prompts'))
    const found = templates.find((t) => t.id === id)
    if (!found) throw new Error(`提示词模板不存在: ${id}`)
    return found
  }

  private async callModel(profileId: string | undefined, system: string, user: string, maxTokens?: number, stream?: AgentStreamOptions): Promise<{ text: string; model: string; provider: string; aborted?: boolean }> {
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]
    if (stream?.opId && stream.onDelta) {
      const streamed = await this.deps.model.streamComplete(stream.opId, profileId, messages, { maxTokens }, stream.onDelta)
      return { text: streamed.text, model: streamed.model, provider: streamed.provider, aborted: streamed.aborted }
    }
    const result = await this.deps.model.complete(profileId, messages, { maxTokens })
    return { text: result.text, model: result.model, provider: result.provider }
  }

  async writeChapter(projectId: string, chapterNo: number, brief?: string, profileId?: string, templateId?: string, stream?: AgentStreamOptions): Promise<{ text: string; model: string; aborted?: boolean }> {
    const packet = await this.deps.workspace.assembleContext(projectId, chapterNo, brief)
    const book = await this.deps.workspace.getProject(projectId)
    const prompt = buildWritePrompt(book, packet)
    let system = '你是资深网文作者，擅长按设定与细纲写出高质量章节。'
    if (templateId) {
      // 题材写作模板：把题材风格约束并入 system 指令
      try {
        const tpl = await this.template(templateId)
        const rendered = renderPromptTemplate(tpl, {
          title: book.title,
          chapterNo: String(chapterNo),
          brief: packet.currentBrief || '（自由发挥）',
        })
        system = `${system}\n\n${rendered}`
      } catch { // 模板缺失时退回默认指令
      }
    }
    const result = await this.callModel(profileId, system, prompt, 8000, stream)
    return { text: result.text, model: result.model, aborted: result.aborted }
  }

  async polish(projectId: string, chapterNo: number, text?: string, instruction?: string, profileId?: string, stream?: AgentStreamOptions): Promise<{ suggestions: PolishSuggestion[]; polished: string; model: string; aborted?: boolean }> {
    const original = text ?? (await this.deps.workspace.getChapter(projectId, chapterNo))?.content ?? ''
    if (!original.trim()) throw new Error('没有可润色的正文')
    const tpl = await this.template('polish-literary')
    const user = instruction
      ? `${renderPromptTemplate(tpl, { text: original })}\n\n附加要求：\n${instruction}`
      : renderPromptTemplate(tpl, { text: original })
    const result = await this.callModel(profileId, '你是资深网文编辑，负责重构式润色。', user, 12000, stream)
    const polished = result.text.trim()
    let suggestions = splitPolishSuggestions(original, polished)
    // 模型原样返回时给一次机会：换更强的重写指令（重试不走流式）
    if (suggestions.length === 0) {
      const retry = await this.callModel(
        profileId,
        '你是资深网文编辑。上一版你把原文原样返回了，这次必须整句重构、大幅扩写，几乎每段都要有可见改动。',
        `原文：\n${original}\n\n请输出重构后的完整正文。`,
        12000,
      )
      const retried = retry.text.trim()
      suggestions = splitPolishSuggestions(original, retried)
      return { suggestions, polished: retried, model: retry.model, aborted: retry.aborted }
    }
    return { suggestions, polished, model: result.model, aborted: result.aborted }
  }

  async depolish(text: string, profileId?: string, stream?: AgentStreamOptions): Promise<{ text: string; model: string; aborted?: boolean }> {
    const tpl = await this.template('polish-depolish')
    const result = await this.callModel(profileId, '你是网文编辑，专门去除 AI 腔。', renderPromptTemplate(tpl, { text }), 8000, stream)
    return { text: result.text.trim(), model: result.model, aborted: result.aborted }
  }

  async styleConvert(projectId: string, chapterNo: number, styleId: string, profileId?: string, stream?: AgentStreamOptions): Promise<{ original: string; revised: string; model: string; aborted?: boolean }> {
    const original = (await this.deps.workspace.getChapter(projectId, chapterNo))?.content ?? ''
    if (!original.trim()) throw new Error('章节不存在')
    const style = await this.template(styleId)
    const result = await this.callModel(
      profileId,
      `你是网文编辑。请严格按以下文风约束改写全章，只输出改写后的完整正文。\n\n${style.template}`,
      `原文：\n${original}`,
      12000,
      stream,
    )
    return { original, revised: result.text.trim(), model: result.model, aborted: result.aborted }
  }

  async revise(projectId: string, chapterNo: number, mode: RevisionMode, profileId?: string, stream?: AgentStreamOptions): Promise<{ original: string; revised: string; mode: RevisionMode; wordDelta: number; changeRatio: number; changed: boolean; model: string; aborted?: boolean }> {
    const original = (await this.deps.workspace.getChapter(projectId, chapterNo))?.content ?? ''
    if (!original.trim()) throw new Error('章节不存在')
    const templateId = mode === 'proofread' ? 'polish-proofread' : mode === 'rhythm' ? 'polish-rhythm' : 'polish-style-unify'
    const tpl = await this.template(templateId)
    const result = await this.callModel(profileId, '你是资深网文编辑。', renderPromptTemplate(tpl, { text: original }), 12000, stream)
    const revised = result.text.trim()
    const stats = buildRevisionResult(mode, chapterNo, original, revised, new Date().toISOString())
    return { ...stats, model: result.model, aborted: result.aborted }
  }

  async applyAdvice(text: string, advice: string, profileId?: string, stream?: AgentStreamOptions): Promise<{ revised: string; model: string; aborted?: boolean }> {
    const result = await this.callModel(
      profileId,
      '你是网文编辑。按建议改写给定片段，保持情节与角色不变。',
      `建议：${advice}\n\n原文：\n${text}\n\n只输出改写结果。`,
      4000,
      stream,
    )
    return { revised: result.text.trim(), model: result.model, aborted: result.aborted }
  }

  async autogenLorebook(bookId: string, profileId?: string): Promise<{ imported: number; names: string[] }> {
    const book = await this.deps.workspace.getProject(bookId)
    const tpl = await this.template('lorebook-autogen')
    const prompt = renderPromptTemplate(tpl, { title: book.title, genre: book.genre })
    const result = await this.callModel(profileId, '你是世界书设定生成助手。只输出 JSON 数组，不要多余文字。', prompt, 4000)
    const raw = result.text.trim()
    const jsonText = /```json\s*([\s\S]*?)\s*```/.exec(raw)?.[1] ?? raw
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      throw new Error('AI 生成结果不是有效 JSON，请重试')
    }
    if (!Array.isArray(parsed)) throw new Error('AI 生成结果应为 JSON 数组')
    const names: string[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const name = typeof rec.name === 'string' ? rec.name.trim() : '未命名'
      const content = typeof rec.content === 'string' ? rec.content.trim() : ''
      if (!content) continue
      const keywords = Array.isArray(rec.keywords) ? rec.keywords.filter((k): k is string => typeof k === 'string') : []
      const alwaysActive = rec.always_active === true
      const now = new Date().toISOString()
      await this.deps.workspace.saveLoreEntry({
        id: `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        content,
        keywords,
        is_regex: false,
        case_sensitive: false,
        always_active: alwaysActive,
        enabled: true,
        priority: alwaysActive ? 90 : 50,
        scan_depth: 0,
        inject_target: 'system',
        inject_position: 'append',
        insertion_depth: 0,
        book_id: bookId,
        volume_id: undefined,
        tags: [],
        version: 1,
        created_at: now,
        updated_at: now,
      })
      names.push(name)
    }
    return { imported: names.length, names }
  }

  async marketResearch(genre: string, topic: string, profileId?: string, stream?: AgentStreamOptions): Promise<{ report: string; model: string; aborted?: boolean }> {
    const tpl = await this.template('creation-market')
    const prompt = renderPromptTemplate(tpl, { genre, seed: topic || '热点方向' })
    const result = await this.callModel(profileId, '你是网文市场调研分析师，输出调研报告。', prompt, 4000, stream)
    return { report: result.text.trim(), model: result.model, aborted: result.aborted }
  }

  /** 通用工具：给渲染进程一个可自定义的完成入口（高级用户/自接端点）。 */
  async complete(profileId: string | undefined, messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }) {
    return await this.deps.model.complete(profileId, messages, options)
  }
}