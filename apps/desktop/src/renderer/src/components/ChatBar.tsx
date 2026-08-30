/**
 * 底部 AI 聊天栏 — 流式输出、Markdown 渲染、可折叠、可拖拽调高。
 */
import { useEffect, useRef } from 'react'
import Markdown from 'react-markdown'
import { useStore } from '../store'
import { IconChevronDown, IconSend, IconX } from './Icons'

export function ChatBar(): JSX.Element {
  const collapsed = useStore((s) => s.chatCollapsed)
  const toggle = useStore((s) => s.toggleChatCollapsed)
  const messages = useStore((s) => s.chatMessages)
  const busy = useStore((s) => s.chatBusy)
  const input = useStore((s) => s.chatInput)
  const setInput = useStore((s) => s.setChatInput)
  const send = useStore((s) => s.sendChat)
  const cancelActiveOp = useStore((s) => s.cancelActiveOp)
  const clearChat = useStore((s) => s.clearChat)
  const models = useStore((s) => s.models)
  const activeModelId = useStore((s) => s.activeModelId)
  const setActiveModel = useStore((s) => s.setActiveModel)
  const openModelSettings = useStore((s) => s.openModelSettings)
  const streaming = useStore((s) => s.streamTarget === 'chat')
  const streamText = useStore((s) => s.streamText)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, busy, streamText])

  // 输入框随内容自动增高
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [input])

  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chat-h')) || 230
    const move = (ev: PointerEvent): void => {
      const h = Math.min(520, Math.max(120, startH + (startY - ev.clientY)))
      document.documentElement.style.setProperty('--chat-h', `${h}px`)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <footer className={`chat-bar ${collapsed ? 'collapsed' : ''}`}>
      {!collapsed && <div className="chat-resizer" onPointerDown={startResize} />}
      <div className="chat-head">
        <button className="icon-btn" title={collapsed ? '展开' : '收起'} onClick={toggle} style={{ transform: collapsed ? 'rotate(180deg)' : undefined }}>
          <IconChevronDown size={15} />
        </button>
        <strong>AI 写作助手</strong>
        <select
          className="chat-model-select"
          value={activeModelId ?? ''}
          onChange={(e) => setActiveModel(e.target.value)}
          title="切换当前模型"
        >
          {models.length === 0 && <option value="">未配置模型</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {models.length === 0 && <button className="link-btn" onClick={openModelSettings}>去配置</button>}
        <span className="flex-spacer" />
        {messages.length > 0 && <button className="icon-btn" title="清空对话" onClick={clearChat}><IconX size={13} /></button>}
      </div>

      {!collapsed && (
        <>
          <div className="chat-messages" ref={scrollRef}>
            {messages.length === 0 && !streaming && (
              <div className="chat-hint">
                与 AI 助手对话即可写作：试试「按玄幻爽文节奏生成第一章」「给正文增加 100 字心理描写」「把这段改成第三人称」。
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`chat-msg ${msg.role}`}>
                {msg.role === 'assistant'
                  ? <div className="chat-msg-content chat-md"><Markdown>{msg.content}</Markdown></div>
                  : <div className="chat-msg-content">{msg.content}</div>}
              </div>
            ))}
            {busy && (
              streaming && streamText
                ? (
                  <div className="chat-msg assistant">
                    <div className="chat-msg-content chat-md streaming"><Markdown>{streamText}</Markdown></div>
                  </div>
                )
                : (
                  <div className="chat-msg assistant">
                    <div className="chat-msg-content typing"><span /><span /><span /></div>
                  </div>
                )
            )}
          </div>
          <div className="chat-input-row">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="向 AI 助手下达写作指令…（Enter 发送，Shift+Enter 换行）"
            />
            {busy ? (
              <button className="send-btn stop" onClick={() => void cancelActiveOp()} title="停止生成">
                <span className="stop-square" />
              </button>
            ) : (
              <button className="send-btn" onClick={() => void send()} disabled={!input.trim()} title="发送">
                <IconSend size={15} />
              </button>
            )}
          </div>
        </>
      )}
    </footer>
  )
}
