# 大肥鱼的小说工坊（桌面版）

独立 Windows 桌面软件，完整保留 [dsh-novel-writer](https://github.com/akira399/dsh-novel-writer) 插件的核心功能，并新增本地库、离线阅读、EPUB/PDF/DOCX 导出、任意 AI 端点接入、WebDAV 云同步与自动更新。

## 功能

- 九阶段创作流程（选题 → 设定 → 人设 → 大纲 → 分卷 → 细纲 → 正文 → 修订 → 完本）
- 世界书（lorebook）管理与 SillyTavern 兼容导入导出
- 一键写章 / 重构式润色 / 去 AI 味 / 文风转换 / 修订
- 黄金三章诊断 / 四族校验 / 一致性巡检（账本、时间线、伏笔、术语、灵感）
- 本地库（素材 / 技能）、DSH 数据兼容迁移
- 离线阅读：txt / md 内置阅读器，PDF / EPUB 调系统默认程序打开
- 导出：txt / markdown / platform / EPUB / PDF / DOCX
- 模型自选：OpenAI 兼容端点 / Anthropic / Google Gemini，密钥仅存主进程
- WebDAV 云同步（坚果云 / Nextcloud / 自建）
- 自动更新（GitHub Releases）

## 开发

```bash
pnpm install
pnpm test
pnpm --filter @dafuyu/desktop dev
pnpm --filter @dafuyu/desktop package:win
```

## 发布

- Windows 安装包在 `apps/desktop/release/`
- 自动更新 feed 使用 GitHub Releases
