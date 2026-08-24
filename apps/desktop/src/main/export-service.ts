/**
 * ExportService — EPUB / DOCX / PDF 导出。
 * EPUB 用 epub-gen；DOCX 用 docx；PDF 用 Electron 内置 printToPDF（中文友好）。
 */
import { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import { WorkspaceService } from './workspace-service.ts'

export interface StructuredBook {
  title: string
  author: string
  chapters: Array<{ no: number; title: string; content: string }>
}

export class ExportService {
  constructor(private readonly workspace: WorkspaceService) {}

  async exportEpub(projectId: string, outPath: string): Promise<string> {
    const book = await this.workspace.exportStructured(projectId)
    // epub-gen is CommonJS; use createRequire to avoid ESM interop issues
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Epub = require('epub-gen') as new (options: Record<string, unknown>, output: string) => Promise<unknown>
    const options = {
      title: book.title,
      author: book.author || '佚名',
      content: book.chapters.map((c) => ({
        title: c.title || `第 ${c.no} 章`,
        data: c.content.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p)}</p>`).join(''),
      })),
    }
    await new Epub(options, outPath)
    return outPath
  }

  async exportDocx(projectId: string, outPath: string): Promise<string> {
    const book = await this.workspace.exportStructured(projectId)
    const children: Paragraph[] = []
    children.push(new Paragraph({ children: [new TextRun({ text: book.title, bold: true, size: 36 })] }))
    if (book.author) children.push(new Paragraph({ children: [new TextRun({ text: `作者：${book.author}`, size: 24 })] }))
    children.push(new Paragraph({ text: '' }))
    for (const chapter of book.chapters) {
      children.push(new Paragraph({ children: [new TextRun({ text: chapter.title || `第 ${chapter.no} 章`, bold: true, size: 28 })] }))
      for (const paragraph of chapter.content.split(/\n{2,}/)) {
        if (paragraph.trim()) children.push(new Paragraph({ children: [new TextRun({ text: paragraph, size: 24 })] }))
      }
    }
    const doc = new Document({ sections: [{ children }] })
    const buffer = await Packer.toBuffer(doc)
    await writeFile(outPath, buffer)
    return outPath
  }

  async exportPdf(projectId: string, outPath: string): Promise<string> {
    const book = await this.workspace.exportStructured(projectId)
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body { font-family: "Microsoft YaHei", "SimSun", sans-serif; font-size: 14px; line-height: 1.8; padding: 40px; }
      h1 { text-align: center; } h2 { margin-top: 32px; } p { text-indent: 2em; margin: 0 0 8px; }
    </style></head><body>
      <h1>${escapeHtml(book.title)}</h1>
      ${book.author ? `<p style="text-align:center">作者：${escapeHtml(book.author)}</p>` : ''}
      ${book.chapters.map((c) => `<h2>${escapeHtml(c.title || `第 ${c.no} 章`)}</h2>${c.content.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p)}</p>`).join('')}`).join('')}
    </body></html>`
    const win = new BrowserWindow({ show: false, width: 800, height: 1000, webPreferences: { sandbox: true } })
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const data = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true })
      await writeFile(outPath, data)
      return outPath
    } finally {
      win.destroy()
    }
  }

  async defaultFileName(projectId: string, ext: string): Promise<string> {
    const book = await this.workspace.exportStructured(projectId)
    return `${book.title || '未命名'}.${ext}`
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
