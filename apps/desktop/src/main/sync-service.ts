/**
 * SyncService — WebDAV 云同步（推送/拉取整个工作区为 zip）。
 * 使用 webdav 客户端 + jszip；配置仅存主进程 settings。
 */
import { join, relative, basename } from 'node:path'
import { readdir, stat, readFile, writeFile, mkdir } from 'node:fs/promises'
import type { SyncConfig } from '@dafuyu/contracts'

export interface SyncServiceDeps {
  loadSettings: () => Promise<Record<string, unknown>>
  saveSettings: (settings: Record<string, unknown>) => Promise<void>
  workspacePath: () => string | null
}

const DEFAULT_REMOTE = 'novel-workshop-backup.zip'

export class SyncService {
  constructor(private readonly deps: SyncServiceDeps) {}

  private config(): SyncConfig | null {
    // 同步读取 settings 快照？这里通过 loadSettings 异步，但 config 方法需同步；改为内部缓存不可靠。
    // 因此所有公开方法先 await loadSettings。
    return null
  }

  private async readConfig(): Promise<SyncConfig | null> {
    const settings = await this.deps.loadSettings()
    const raw = settings.syncConfig
    return raw && typeof raw === 'object' ? raw as SyncConfig : null
  }

  async status(): Promise<{ configured: boolean; url?: string; remotePath?: string; lastSyncAt?: string }> {
    const config = await this.readConfig()
    const settings = await this.deps.loadSettings()
    if (!config) return { configured: false }
    return {
      configured: true,
      url: config.url,
      remotePath: config.remotePath || DEFAULT_REMOTE,
      lastSyncAt: typeof settings.lastSyncAt === 'string' ? settings.lastSyncAt : undefined,
    }
  }

  async saveConfig(config: SyncConfig): Promise<void> {
    const settings = await this.deps.loadSettings()
    await this.deps.saveSettings({ ...settings, syncConfig: config })
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const config = await this.readConfig()
      if (!config) return { ok: false, message: '未配置 WebDAV' }
      const client = await this.client(config)
      await client.getDirectoryContents('/')
      return { ok: true, message: 'WebDAV 连接成功' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  async push(): Promise<{ message: string }> {
    const workspace = this.deps.workspacePath()
    if (!workspace) throw new Error('尚未选择工作区')
    const config = await this.readConfig()
    if (!config) throw new Error('未配置 WebDAV')
    const client = await this.client(config)
    const buffer = await this.zipWorkspace(workspace)
    const remotePath = config.remotePath?.trim() || DEFAULT_REMOTE
    await client.putFileContents(remotePath, buffer, { overwrite: true })
    const settings = await this.deps.loadSettings()
    await this.deps.saveSettings({ ...settings, lastSyncAt: new Date().toISOString() })
    return { message: `已推送 ${(buffer.byteLength / 1024).toFixed(1)} KB 到 ${remotePath}` }
  }

  async pull(): Promise<{ message: string }> {
    const workspace = this.deps.workspacePath()
    if (!workspace) throw new Error('尚未选择工作区')
    const config = await this.readConfig()
    if (!config) throw new Error('未配置 WebDAV')
    const client = await this.client(config)
    const remotePath = config.remotePath?.trim() || DEFAULT_REMOTE
    const buffer = await client.getFileContents(remotePath) as Buffer
    await this.unzipWorkspace(workspace, buffer)
    const settings = await this.deps.loadSettings()
    await this.deps.saveSettings({ ...settings, lastSyncAt: new Date().toISOString() })
    return { message: `已从 ${remotePath} 拉取并解压 ${(buffer.byteLength / 1024).toFixed(1)} KB` }
  }

  private async client(config: SyncConfig) {
    const { createClient } = await import('webdav')
    return createClient(config.url, {
      username: config.username,
      password: config.password,
    })
  }

  private async zipWorkspace(workspace: string): Promise<Buffer> {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    const folders = ['projects', 'lorebook', 'library']
    for (const folder of folders) {
      const dir = join(workspace, folder)
      await this.addDirToZip(zip, dir, folder)
    }
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  }

  private async addDirToZip(zip: import('jszip'), dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir).catch(() => [] as string[])
    for (const name of entries) {
      const full = join(dir, name)
      const info = await stat(full)
      const rel = join(prefix, name)
      if (info.isDirectory()) {
        await this.addDirToZip(zip, full, rel)
      } else if (info.isFile()) {
        const data = await readFile(full)
        zip.file(rel.split('\\').join('/'), data)
      }
    }
  }

  private async unzipWorkspace(workspace: string, buffer: Buffer): Promise<void> {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer)
    const entries = Object.values(zip.files)
    for (const entry of entries) {
      if (entry.dir) continue
      const target = join(workspace, entry.name.split('/').join('\\'))
      // 安全：只允许解压到工作区内
      const relativePath = relative(workspace, target)
      if (relativePath.startsWith('..') || relativePath.startsWith('.git')) continue
      await mkdir(join(target, '..'), { recursive: true })
      const content = await entry.async('nodebuffer')
      await writeFile(target, content)
    }
  }
}
