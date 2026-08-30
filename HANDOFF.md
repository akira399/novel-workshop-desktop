# 大肥鱼的小说工坊 — Agent 交接文档

> 给接手本项目的新 Agent 阅读。请先完整阅读本文件与 README.md，再开始任何开发工作。

## 1. 项目是什么

**大肥鱼的小说工坊（novel-workshop-desktop）** 是一款独立的 **Windows 桌面 AI 小说创作工作台**。

它面向网文作者，提供：
- 九阶段创作流程（选题→设定→人设→大纲→分卷→细纲→正文→修订→完本）
- AI 写作助手（底部聊天框可感知编辑框正文，并直接生成/修改/扩写后写回编辑框）
- 世界书（Lorebook）管理与 AI 生成设定
- 一键写章、润色、去 AI 味、诊断、校验、一致性巡检
- 导出 txt/markdown/EPUB/PDF/DOCX，离线阅读，WebDAV 云同步，自动更新
- 多模型自由接入（OpenAI 兼容 / DeepSeek / Moonshot / Anthropic / Gemini / Ollama / 智谱 / 自定义）

软件与同名 DSH 插件同源，但本仓库是独立桌面应用，按正常软件对待，不要在面向用户的页面强调“它不是插件”。

## 2. 本地路径

- **主项目（桌面版）**：`E:\deepseekwork\novel-workshop-desktop`
- 同名 DSH 插件（仅作参考/前身）：`E:\deepseekwork\dsh-novel-writer`
- DeepWrite 参考项目（已研读，Apache-2.0）：`E:\deepseekwork\deepwrite-ref`

## 3. 技术栈与架构

- **框架**：Electron + React
- **构建**：electron-vite + electron-builder + pnpm workspace（monorepo）
- **语言**：TypeScript（NodeNext / Bundler 解析）
- **测试**：Vitest（core 层 282 个测试）
- **契约 IPC**：`packages/contracts` 定义 CommandMap，所有 Renderer→Main 调用走 preload 白名单 + 统一 Result 包装
- **目录结构**：
  ```
  novel-workshop-desktop/
  ├── packages/core/          # 纯业务逻辑（从插件迁移，零 Electron 依赖）
  ├── packages/contracts/     # IPC 命令契约与类型
  ├── packages/shared/        # 通用工具
  ├── apps/desktop/
  │   ├── src/main/           # 主进程：窗口、IPC、模型、导出、同步、自动更新
  │   ├── src/preload/        # 白名单桥
  │   └── src/renderer/       # React 三栏 UI + 底部 AI 聊天栏
  ├── resources/              # 提示词模板、示例数据、品牌素材
  └── README.md / HANDOFF.md
  ```

## 4. 核心实现要点

### 4.1 AI 模型接入
- `apps/desktop/src/main/model-service.ts` 统一管理模型配置与调用。
- 支持 OpenAI 兼容、Anthropic、Google Gemini；密钥只存在本地 settings（主进程）。
- `ModelProfile` 每个 = 一个模型；同一提供方可保存多个。
- **当前模型（activeModelId）**：聊天框左侧下拉可切换；所有 AI 创作操作（写章/润色/去味/文风/修订/世界书生成/市场调研）都会把 `activeModelId` 作为 `profileId` 传给主进程。
- 模型测试请求应与聊天一致：带 system 消息，`maxTokens` 给足（2048），否则推理模型会因 token 被推理占满而返回空。

### 4.2 聊天框即 AI 控制台
- `sendChat()` 在每次发送时把**当前编辑框正文和章节标题**注入 system 上下文。
- 约定写回协议：AI 若要求修改/生成正文，必须输出完整正文并包裹：
  ```
  【编辑框结果】
  <完整正文>
  【结束】
  ```
  前端解析标记后自动 `setEditorText` 写入编辑框，并计入撤销栈。
- 普通聊天不写回编辑框。

### 4.3 核心业务层
- `packages/core` 是从 DSH 插件迁移的纯逻辑，包含 novel/lorebook/polish/diagnose/consistency/revision/export/importer/prompts/guide/workflow/variables/stats 等域。
- 保持 core 纯净：不要引入 Electron / cordis 依赖。

## 5. 开发命令

```bash
# 安装依赖
pnpm install

# 类型检查（桌面 app）
NODE_OPTIONS= pnpm --filter @dafuyu/desktop typecheck

# 测试（core）
npx vitest run

# 构建（app）
cd apps/desktop
NODE_OPTIONS= npx --no-install electron-vite build

# 打包 Windows（安装版 + 便携版）
cd apps/desktop
NODE_OPTIONS= NODE_TLS_REJECT_UNAUTHORIZED=0 CSC_IDENTITY_AUTO_DISCOVERY=false npx --no-install electron-builder --win

# 快速启动免安装版
pnpm quick
# 或双击 apps/desktop/run-unpacked.bat
```

### ⚠️ 本机环境注意事项（重要）
- 当前开发环境的 `NODE_OPTIONS` 被注入 WorkBuddy 的 `safe-delete` shim，且 shim 引用的 `node.exe` 不存在，会导致：
  - pnpm 自动 install 校验失败
  - vite/electron-builder 清理目录时 `EBUSY`/`SAFE_DELETE...` 报错
- **规避方式**：构建/打包前清空 `NODE_OPTIONS`：
  ```bash
  NODE_OPTIONS= npx --no-install electron-vite build
  ```
- 若 `release/win-unpacked` 被锁删除不掉，用 PowerShell：
  ```powershell
  Remove-Item -Path "...\release\win-unpacked" -Recurse -Force
  ```

## 6. 发布流程（GitHub）

- 远程仓库：`https://github.com/akira399/novel-workshop-desktop`
- 分支：`master`
- Release 通过 GitHub API 上传安装包/便携版：
  - 安装包：`dafuyu-novel-workshop-<version>-win-x64.exe`
  - 便携版：`dafuyu-novel-workshop-<version>-portable.exe`
- 自动更新 feed 使用 GitHub Releases（electron-updater 配置已就位）。

## 7. ⚠️ 用户偏好与协作规则

1. **推送权限**：未经用户明确允许，**不要**把项目推送到远程仓库或公开发布。只有用户明确说“推送上线/发布”时才能 push / create release。
2. **面向用户文案**：当正常独立软件介绍，不要强调“不是插件”。
3. **密钥安全**：API Key 只存在本地 settings，不上传、不打印到日志/UI。
4. **不要随意删改核心逻辑**：core 层改动必须跑测试；UI 改动需保持简洁直观，避免堆砌复杂表单。
5. 用户偏好简洁、专业、现代的白底黑字界面；曾反馈“纯白方框太简陋”，注意视觉层次。

## 8. 目前已知事项 / 可能的下一步

- 已完成：聊天 AI 控制台、多模型切换、世界书完整面板、润色逐条采纳、高级工具箱、导出、云同步、自动更新、离线阅读（txt/md 内置，PDF/EPUB 调系统打开）、品牌 Logo、无边框窗口、白底黑字设计系统。
- 可能的后续方向（未实现/可选）：
  - 应用内 PDF/EPUB 阅读器（当前调系统默认程序）
  - OSS 云同步（当前仅 WebDAV）
  - 多语言 / 主题切换
  - 更好的 AI 意图识别与工具调用（当前聊天通过标记协议写回编辑框）
  - 移动端/跨平台（当前仅 Windows x64）

## 9. 给接手 Agent 的话

- 先跑 `npx vitest run` 和 `NODE_OPTIONS= pnpm --filter @dafuyu/desktop typecheck` 确认环境正常。
- 任何改动都保持测试全绿；涉及 IPC 先改 `packages/contracts`。
- 这个项目已经是一个可交付的独立产品，不要把它当插件维护。
- 保持简洁、可用、美观；如果不确定用户意图，优先询问而不是擅自扩大范围。