/**
 * 界面常量 — 题材/提供方/阶段等下拉数据源。
 */
import { GENRES } from '@dafuyu/core/genres'
import type { ModelProfile } from '@dafuyu/contracts'
import type { PhaseId } from '@dafuyu/core/workflow'

export { GENRES }

export const PROVIDER_PRESETS: Array<{ id: ModelProfile['provider']; label: string; baseUrl: string }> = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'moonshot', label: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'ollama', label: 'Ollama（本地）', baseUrl: 'http://127.0.0.1:11434/v1' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '' },
]

export const PHASE_LABELS: Record<PhaseId, string> = {
  topic: '选题',
  setting: '设定',
  character: '人设',
  outline: '大纲',
  volume: '分卷',
  chapter: '细纲',
  writing: '正文',
  revision: '修订',
  done: '完本',
}

export const EXPORT_TEXT_FORMATS = [
  { value: 'txt', label: '纯文本（.txt）' },
  { value: 'markdown', label: 'Markdown（.md）' },
  { value: 'platform', label: '平台排版文本' },
] as const

export const EXPORT_RICH_FORMATS = [
  { value: 'epub', label: 'EPUB 电子书' },
  { value: 'pdf', label: 'PDF 文档' },
  { value: 'docx', label: 'Word 文档（.docx）' },
] as const

export const REVISION_MODES = [
  { value: 'proofread', label: '校对（错别字/语病）' },
  { value: 'rhythm', label: '节奏（段落/节奏感）' },
  { value: 'style', label: '文风统一' },
] as const

export const STYLE_OPTIONS = [
  { value: 'style-xuanhuan', label: '玄幻' },
  { value: 'style-xianxia', label: '仙侠' },
  { value: 'style-game', label: '游戏' },
  { value: 'style-historical', label: '历史' },
  { value: 'style-humor', label: '幽默' },
  { value: 'style-scifi', label: '科幻' },
  { value: 'style-suspense', label: '悬疑' },
  { value: 'style-urban', label: '都市' },
]

export function genreLabel(id: string): string {
  return GENRES.find((g) => g.id === id)?.label ?? id
}
