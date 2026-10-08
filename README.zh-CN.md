# opencode Dialog Explorer

[English](./README.md) | 中文

一个基于 Vite + React 的小工具，用于浏览本地 **opencode** 的历史对话
（`~/.local/share/opencode/opencode.db`），支持搜索/筛选、预览消息，并复制可直接运行的会话恢复命令。

本项目 fork 自 [daniel-farina/ai-session-manager](https://github.com/daniel-farina/ai-session-manager)
（`ai-session-manager`），精简为单一数据源 —— opencode —— 作为更完善的对话浏览器的基础。
后续规划见 `IMPLEMENTATION.md`。

## 数据源

| 工具 | 读取位置 | 恢复命令 |
|------|----------|----------|
| **opencode** | `~/.local/share/opencode/opencode.db`（SQLite） | `opencode --session <id>` |

只列出顶层会话（`parent_id IS NULL`）且至少有一条消息的会话。数据库不存在时，列表为空。

## 隐私与安全

- **数据全部留在本地。** 应用只读取 opencode 已写入你主目录的 SQLite 数据库，并把它提供给自己的浏览器。无遥测、无网络请求、不打包也不上传任何内容。
- 服务**仅绑定 localhost**（在 `vite.config.js` 中强制）。不要用 `--host` 运行——否则任何能访问该端口的人都能读到你的私有对话历史。
- 数据库以**只读**方式打开。会话 ref 会做格式校验（`ses_…`），使 API 只能读取合法的 session id。`/api/open` 会校验路径，并通过 `execFile` 以参数数组方式调用系统打开器，绝不经过 shell。

## 平台支持

- **macOS** —— 打开文件夹使用 `open`。
- **Linux** —— 打开文件夹使用 `xdg-open`。
- **Windows** —— 打开文件夹使用 `explorer`。

## 运行

```bash
npm install
npm run dev      # 打开 http://localhost:4570
npm test         # 针对本地数据做适配器 + 接口冒烟测试
npm run build && npm run preview   # 运行生产构建（含 API）
```

API 以 Vite 中间件形式**同时**挂在 dev server 与 preview server 上，因此构建产物 `dist/` 通过
`npm run preview` 可完整运行（它仍读取本地数据库——不会打包或发送任何数据）。

需要 Node 22+ 及内置 `node:sqlite`（Node 22 上出现 `ExperimentalWarning` 属正常）。

`npm test`（`scripts/smoke-test.mjs`）会列出会话、拉取一条详情，并校验数据契约（key 唯一、
必填字段完整、无未来时间戳、消息 role 合法、按时间倒序），以及 ref 穿越拒绝与 open-path 模块。
任一失败即以非零码退出。本机尚无 opencode 数据时，依赖数据的检查会被跳过。

## 工作原理

- `vite.config.js` 中一个极小的 dev-server API 委托给 `server/sources/opencode.js` 的 opencode
  **源适配器**；该适配器导出 `{ source, list, detail }`，并通过 `_shared.js` 的 `makeEntry`
  返回归一化记录。
- `GET /api/conversations` 为每个顶层会话返回一条记录（标题、项目、分支、消息数、最近活动、
  可直接运行的恢复命令），按最近优先排序。
- `GET /api/conversation?source=…&ref=…` 返回某会话最近 30 条消息。
- `GET /api/search?q=…` 在缓存的转录上做全文搜索。
- `GET /api/open?path=…` 在系统文件管理器中打开项目文件夹。
- `GET /api/sources` 返回展示元数据（标签 + 主题色）。

## 功能

- **搜索** 标题、项目、路径、session id 与首条消息（外加全文搜索）。
- **筛选** 按项目（下拉）与仅星标。
- **排序** 最近 / 最早 / 消息最多 / 标题 A–Z。
- **筛选持久化** 刷新后保留（`localStorage` 的 `ocde.filters`）。
- **展开** 任意卡片查看最近 30 条消息，带颜色区分，工具调用与结果内联展示。
- **复制恢复命令** —— 精确的 `cd "<cwd>" && opencode --session <id>`。
- **打开** —— 在系统文件管理器中打开会话对应的项目文件夹。
- **星标** —— 收藏你关心的会话（存于 `localStorage`）。
- **PWA** —— 可安装（`public/manifest.webmanifest`、`public/sw.js`、图标；由 `src/pwa.js`
  注册）。Service Worker 采用 network-first，不会返回过期内容，也不干扰 dev/HMR；
  `/api/*` 始终走网络。

## 许可证

[MIT](LICENSE)
