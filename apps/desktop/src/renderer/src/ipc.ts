/**
 * IPC 调用助手 — 渲染层统一入口。
 * 所有主进程调用走 preload 白名单 invoke；错误统一抛出 Error。
 */
import type { CommandMap, CommandName, CommandRequest, CommandResponse } from '@dafuyu/contracts'

export async function call<K extends CommandName>(command: K, payload: CommandRequest<K>): Promise<CommandResponse<K>> {
  const result = await window.novelWorkshop.invoke(command, payload)
  if (result.ok) return result.value
  throw new Error(result.error.message)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
