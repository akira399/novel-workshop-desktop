/**
 * 编辑器状态栏 — 文档信息与字数。
 */
interface StatusBarProps {
  left: string
  words: number
  paragraphs: number
}

export function StatusBar({ left, words, paragraphs }: StatusBarProps): JSX.Element {
  return (
    <div className="status-bar">
      <span className="status-left" title={left}>{left}</span>
      <span className="flex-spacer" />
      <span className="status-right">
        {words.toLocaleString()} 字 · {paragraphs} 段
      </span>
    </div>
  )
}
