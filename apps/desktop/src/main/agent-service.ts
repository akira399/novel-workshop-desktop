/**
 * AgentService — 主进程内的 AI 创作动作。
 * 组合 core 上下文/模板 + ModelService，向渲染进程提供写章/润色/去味/文风/修订。
 * 密钥不离开主进程。
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

export class AgentService {
  constructor(private readonly deps: AgentServiceDeps) {}

  private async template(id: string): Promise<PromptTemplate> {
    const templates = await loadPromptLibrary(join(this.deps.resourcesDir, 'prompts'))
    const found = templates.find((t) => t.id === id)
    if (!found) throw new Error(`提示词模板不存在: ${id}`)
    return found
  }

  private async callModel(profileId: string | undefined, system: string, user: string, maxTokens?: number) {
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]
    return await this.deps.model.complete(profileId, messages, { maxTokens })
  }

  async writeChapter(projectId: string, chapterNo: number, brief?: string): Promise<{ text: string; model: string }> {
    const packet = await this.deps.workspace.assembleContext(projectId, chapterNo, brief)
    const book = await this.deps.workspace.getProject(projectId)
    const prompt = buildWritePrompt(book, packet)
    const result = await this.callModel(undefined, '你是资深网文作者，擅长按设定与细纲写出高质量章节。', prompt, 8000)
    return { text: result.text, model: result.model }
  }

  async polish(projectId: string, chapterNo: number, text?: string, instruction?: string): Promise<{ suggestions: PolishSuggestion[]; polished: string; model: string }> {
    const original = text ?? (await this.deps.workspace.getChapter(projectId, chapterNo))?.content ?? ''
    if (!original.trim()) throw new Error('没有可润色的正文')
    const tpl = await this.template('polish-literary')
    const user = instruction
      ? `${renderPromptTemplate(tpl, { text: original })}\n\n附加要求：\n${instruction}`
      : renderPromptTemplate(tpl, { text: original })
    const result = await this.callModel(undefined, '你是资深网文编辑，负责重构式润色。', user, 12000)
    const polished = result.text.trim()
    let suggestions = splitPolishSuggestions(original, polished)
    // 模型原样返回时给一次机会：换更强的重写指令
    if (suggestions.length === 0) {
      const retry = await this.callModel(
        undefined,
        '你是资深网文编辑。上一版你把原文原样返回了，这次必须整句重构、大幅扩写，几乎每段都要有可见改动。',
        `原文：\n${original}\n\n请输出重构后的完整正文。`,
        12000,
      )
      const retried = retry.text.trim()
      suggestions = splitPolishSuggestions(original, retried)
      return { suggestions, polished: retried, model: retry.model }
    }
    return { suggestions, polished, model: result.model }
  }

  async depolish(text: string): Promise<{ text: string; model: string }> {
    const tpl = await this.template('polish-depolish')
    const result = await this.callModel(undefined, '你是网文编辑，专门去除 AI 腔。', renderPromptTemplate(tpl, { text }), 8000)
    return { text: result.text.trim(), model: result.model }
  }

  async styleConvert(projectId: string, chapterNo: number, styleId: string): Promise<{ original: string; revised: string; model: string }> {
    const original = (await this.deps.workspace.getChapter(projectId, chapterNo))?.content ?? ''
    if (!original.trim()) throw new Error('章节不存在')
    const style = await this.template(styleId)
    const result = await this.callModel(
      undefined,
      `你是网文编辑。请严格按以下文风约束改写全章，只输出改写后的完整正文。\n\n${style.template}`,
      `原文：\n${original}`,
      12000,
    )
    return { original, revised: result.text.trim(), model: result.model }
  }

  async revise(projectId: string, chapterNo: number, mode: RevisionMode): Promise<{ original: string; revised: string; mode: RevisionMode; wordDelta: number; changeRatio: number; changed: boolean; model: string }> {
    const original = (await this.deps.workspace.getChapter(projectId, chapterNo))?.content ?? ''
    if (!original.trim()) throw new Error('章节不存在')
    const templateId = mode === 'proofread' ? 'polish-proofread' : mode === 'rhythm' ? 'polish-rhythm' : 'polish-style-unify'
    const tpl = await this.template(templateId)
    const result = await this.callModel(undefined, '你是资深网文编辑。', renderPromptTemplate(tpl, { text: original }), 12000)
    const revised = result.text.trim()
    const stats = buildRevisionResult(mode, chapterNo, original, revised, new Date().toISOString())
    return { ...stats, model: result.model }
  }

  async applyAdvice(text: string, advice: string): Promise<{ revised: string; model: string }> {
    const result = await this.callModel(
      undefined,
      '你是网文编辑。按建议改写给定片段，保持情节与角色不变。',
      `建议：${advice}\n\n原文：\n${text}\n\n只输出改写结果。`,
      4000,
    )
    return { revised: result.text.trim(), model: result.model }
  }

  async autogenLorebook(bookId: string): Promise<{ imported: number; names: string[] }> {
    const book = await this.deps.workspace.getProject(bookId)
    const tpl = await this.template('lorebook-autogen')
    const prompt = renderPromptTemplate(tpl, { title: book.title, genre: book.genre })
    const result = await this.callModel(undefined, '你是世界书设定生成助手。只输出 JSON 数组，不要多余文字。', prompt, 4000)
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

  async marketResearch(genre: string, topic: string): Promise<{ report: string; model: string }> {
    const tpl = await this.template('creation-market')
    const prompt = renderPromptTemplate(tpl, { genre, seed: topic || '热点方向' })
    const result = await this.callModel(undefined, '你是网文市场调研分析师，输出调研报告。', prompt, 4000)
    return { report: result.text.trim(), model: result.model }
  }

  /** 通用工具：给渲染进程一个可自定义的完成入口（高级用户/自接端点）。 */
  async complete(profileId: string | undefined, messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }) {
    return await this.deps.model.complete(profileId, messages, options)
  }
}
