# opencode Dialog Explorer

[English](./README.md) | 中文

一个以项目为入口的本地 **opencode** 对话档案浏览器：找到做过的项目，重读会话，跳转到历史提问，或跨项目检索完整记录。需要继续工作时，复制恢复命令到终端运行。这里是阅读器，不是聊天客户端。

基于 Vite + React，fork 自 [daniel-farina/ai-session-manager](https://github.com/daniel-farina/ai-session-manager)，专注读取本机的 opencode SQLite 数据库。

## 能做什么

- **按项目浏览**：依据 opencode 的 `project_id` 归类，而非仅凭目录名。可按名称或路径查找项目，并在项目内按标题、工作路径筛选会话，或按时间、标题、消息数排序。
- **阅读完整历史**：逐页加载更早的消息，以 Markdown 展示正文；工具调用和思考过程可折叠查看。开启「仅问答」后，阅读时隐藏工具调用与思考过程。
- **按提问定位**：紧凑的提问轨道可滚动、可预览，会跟随当前阅读位置；点击未加载的历史提问时会加载并定位原文。
- **跨项目搜索**：检索会话标题、项目名称、路径、标签、备注及历史文本。正文命中可跳到对应消息。用 `Ctrl+K` / `⌘K` 或 `/` 聚焦搜索。
- **整理档案**：置顶项目与会话，为项目添加别名和备注，为会话添加标签和备注；需要修改 opencode 中的标题时可直接重命名会话。
- **回到工作现场**：复制恢复命令或 Session ID，或尝试在系统文件管理器中打开项目目录。界面适配窄屏，也支持作为 PWA 安装。

## 开始使用

需要 **Node.js 22+**（内置 `node:sqlite`）以及本机 `~/.local/share/opencode/opencode.db`。

```bash
npm install
npm run dev
```

打开 `http://localhost:4570`。数据库不存在或没有非空顶层会话时，档案列表为空；索引仅展示 `parent_id IS NULL` 且至少有一条消息的会话。Node 22 下 `node:sqlite` 的 `ExperimentalWarning` 属正常现象。

```bash
npm test                       # 冒烟与档案测试
npm run build
npm run preview               # 运行带本地 API 的构建版
```

开发和预览模式都由 Vite 中间件提供 API。构建产物不包含你的会话；预览模式仍读取运行服务的那台机器上的数据库。服务应只在 localhost 使用，因为接口会返回私有对话历史。

## 数据存放位置

| 数据 | 位置 | 行为 |
|------|------|------|
| 对话、项目与消息正文 | `~/.local/share/opencode/opencode.db` | 除会话改名外只读 |
| 置顶、别名、标签、备注 | `data/meta.json` | 本应用的本地 sidecar，已被 Git 忽略 |
| 会话标题 | opencode 的 `session.title` | 仅在重命名时写入，不修改 `time_updated` |

应用没有遥测或外部 CDN；页面只向本机服务请求数据。使用前会校验会话 ID 和目录路径。打开目录通过不经过 shell 的系统命令执行：macOS 用 `open`，Linux 用 `xdg-open`，Windows 用 `explorer`，WSL 用转换后的 Windows 路径调用 `explorer.exe`。「打开目录」返回成功表示已尝试执行，不保证文件管理器一定显示该目录。

要继续某段会话，在终端执行复制的命令：

```bash
cd "<会话工作目录>" && opencode --session <会话 ID>
```

## 工作原理

- `server/archive.js` 读取项目和会话索引、分页返回消息、生成用户提问目录并检索历史文本。宽泛的正文搜索可能较慢；搜索结果每个会话最多展示一处命中，界面最多展示 100 个会话。
- `server/meta.js` 将本应用的整理信息写入 `data/meta.json`；`server/rename.js` 负责可选的 opencode 会话标题写入。
- `vite.config.js` 在开发和预览模式中挂载本地 API；旧版会话与搜索接口仍保留兼容。
- 可安装 PWA 的 Service Worker 采用 network-first；API 请求始终访问本机服务，不使用离线缓存。

背景与设计决策参见 [UI 重构方案](./docs/UI-REDESIGN.md) 和 [早期实施规划](./docs/IMPLEMENTATION.md)。

## 许可证

[MIT](LICENSE)
