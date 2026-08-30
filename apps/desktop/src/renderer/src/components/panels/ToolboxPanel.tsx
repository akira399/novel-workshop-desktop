/**
 * 工具箱面板 — 分类收纳的低频工具与危险操作。
 */
import { call } from '../../ipc'
import { useStore } from '../../store'

export function ToolboxPanel(): JSX.Element {
  const setPanel = useStore((s) => s.setPanel)
  const writeChapterAI = useStore((s) => s.writeChapterAI)
  const polishAI = useStore((s) => s.polishAI)
  const depolishAI = useStore((s) => s.depolishAI)
  const styleConvertAI = useStore((s) => s.styleConvertAI)
  const reviseAI = useStore((s) => s.reviseAI)
  const applyAdviceAI = useStore((s) => s.applyAdviceAI)
  const validateAI = useStore((s) => s.validateAI)
  const diagnoseAI = useStore((s) => s.diagnoseAI)
  const wordcountAI = useStore((s) => s.wordcountAI)
  const showPrompts = useStore((s) => s.showPrompts)
  const exportText = useStore((s) => s.exportText)
  const exportRich = useStore((s) => s.exportRich)
  const exportSillyTavern = useStore((s) => s.exportSillyTavern)
  const askPrompt = useStore((s) => s.askPrompt)
  const showResult = useStore((s) => s.showResult)
  const run = useStore((s) => s.run)
  const deleteBook = useStore((s) => s.deleteBook)

  const doParseIntent = async (): Promise<void> => {
    const text = await askPrompt('输入自然语言指令', '', { placeholder: '如：进入下一阶段 / 登记伏笔' })
    if (!text) return
    await run(async () => {
      const intent = await call('guide:parseIntent', { text })
      await showResult('意图解析', intent ? `动作：${intent.action}\n置信度：${Math.round(intent.confidence * 100)}%` : '未命中任何已知意图')
    })
  }

  return (
    <div className="panel-body">
      <div className="panel-section">
        <div className="panel-section-head"><span>AI 动作</span></div>
        <div className="btn-grid">
          <button onClick={() => void writeChapterAI()}>AI 写章</button>
          <button onClick={() => void polishAI()}>一键润色</button>
          <button onClick={() => void depolishAI()}>去 AI 味</button>
          <button onClick={() => void styleConvertAI()}>文风转换</button>
          <button onClick={() => void reviseAI()}>AI 修订</button>
          <button onClick={() => void applyAdviceAI()}>应用建议</button>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-head"><span>质量与统计</span></div>
        <div className="btn-grid">
          <button onClick={() => void validateAI()}>章节校验</button>
          <button onClick={() => void diagnoseAI()}>黄金三章诊断</button>
          <button onClick={() => void wordcountAI()}>字数统计</button>
          <button onClick={() => void showPrompts()}>提示词库</button>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-head"><span>导出</span></div>
        <div className="btn-grid">
          <button onClick={() => void exportText()}>导出文本</button>
          <button onClick={() => void exportRich()}>导出电子书</button>
          <button onClick={() => void exportSillyTavern()}>世界书 → 酒馆</button>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-head"><span>其他</span></div>
        <div className="btn-grid">
          <button onClick={() => setPanel('data')}>资料库</button>
          <button onClick={() => void doParseIntent()}>意图解析</button>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-head danger-head"><span>危险操作</span></div>
        <div className="btn-grid">
          <button className="danger" onClick={() => void deleteBook()}>删除当前作品</button>
        </div>
      </div>
    </div>
  )
}
