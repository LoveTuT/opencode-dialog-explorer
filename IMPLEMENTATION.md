# opencode Dialog Explorer — 实施文档（改造 / 重构 / 补充逻辑）

> 本文档只描述**要做什么、改哪些文件、怎么改**，不含具体实现代码。具体改动待确认后再执行。

## 0. 基线与来源

- 项目：`daniel-farina/ai-session-manager`（MIT）
- 上游：https://github.com/daniel-farina/ai-session-manager
- 基线提交：`dfdbf0f36d3b3e83dd08b7f423cb62c37a010992`（2026-06-10，main）
- 本地路径：`/home/wanghj/projects/projects-self/opencode-dialog-explorer`
- 已 `git init`（分支 `main`），并添加 `upstream` 远程指向原仓库，便于后续同步上游修复。
- 运行环境：本机 Node **v22.22**（基线声明 `node>=24`，但 `node:sqlite` 在 22 可用，仅实验性告警）；sqlite3 CLI 3.50。
- 运行位置：**WSL**，浏览器经 `http://localhost:<port>` 访问（避免 `\\wsl$` 路径问题）。

## 1. 目标与硬约束（已与需求方确认）

| 项 | 决定 |
|---|---|
| 定位 | 面向非命令行用户，**浏览/检索/管理**本地 opencode 历史对话的 Web 应用 |
| 数据源 | 仅 **opencode**（`~/.local/share/opencode/opencode.db`），移除其余 8 个工具适配器 |
| 置顶 / 标签 / 自定义排序 / 备注 | **只写本系统旁挂数据（sidecar）**，绝不影响 opencode 原始 session |
| 改名 | **允许直接改动** opencode 对应 session 的 `title`（唯一写主库操作） |
| 删除会话 | **不提供** |
| 刷新 | **不做实时监听**：手动刷新按钮 + 打开/切换会话时触发刷新 |
| 核心增强 | 同一会话内**按用户提问生成目录（TOC）**并支持快速定位 |
| 端口 | `4570`（当前 WSL 已占用 19825/44755/3307/5433，4570 空闲）；替换基线默认 5191 |
| 语言/栈 | 沿用基线的 **Node + Vite + React（JS，非 TS）**，不自建 |

## 2. 基线现状盘点

### 2.1 结构
```
index.html
vite.config.js            # Vite 插件内实现 API 中间件（dev + preview 双挂载）
server/
  sources/index.js        # 适配器注册 + 合并（当前 9 个源）
  sources/opencode.js     # opencode 适配器（本项目核心，复用）
  sources/_shared.js      # makeEntry / SOURCE_META / 文本工具
  sources/{claude,codex,grok,cursor,gemini,copilot,goose,droid}.js  # 待移除
  search.js               # 内存全文搜索（首搜慢，按 mtime 缓存）
  open.js                 # 调 OS 打开目录
  agents.js / usage.js    # 待移除
src/
  App.jsx                 # 单文件主界面（卡片列表 + 展开30条消息）
  sortConvos.js           # 纯排序逻辑
  Metrics.jsx / MiniStats.jsx / Usage.jsx / Agents.jsx  # 待移除
  *.css
scripts/smoke-test.mjs    # 数据契约测试
public/                   # PWA 资源
```

### 2.2 可直接复用
- `server/sources/opencode.js`：已正确读取 `session/message/part`，`parent_id IS NULL`，`part.type=text|reasoning|tool` 渲染，`ses_` 正则校验。
- `makeEntry` 归一化结构、`/api/conversations`、`/api/conversation`、`/api/search`、`/api/open` 契约。
- 前端：卡片列表、客户端 `star`（localStorage，`ccv.starred`）、排序下拉、内容搜索联动、增量渲染。
- 隐私基线：服务仅绑 `localhost`；`open.js` 用 `execFile` 无 shell。

### 2.3 基线已有但需改造/替换
- **已有 star**：纯前端 localStorage，仅本机浏览器可见 → 需升级为**服务端持久化**的置顶/标签。
- **详情只取最近 30 条**（`detail(ref, lastN=30)`）→ TOC 定位需要**全量/分页**转录。
- **卡片展开式 UI**：不适合"目录 + 正文"浏览 → 重构为**左列表 + 右详情（含 TOC 侧栏）**。
- 多源 UI（工具 chips、项目过滤按 source、Agents/Usage/Metrics 面板）→ 精简为单一 opencode。

## 3. 目标架构

```
opencode.db(只读) ──┐
                    ├──▶ server/sources/opencode.js ──▶ /api/conversations
                    │                                   /api/conversation (全量/分页)
                    │                                   /api/toc
opencode.db(读写*) ─┘                                   /api/rename   (*仅 UPDATE title)
                                    server/meta.js ──▶  /api/meta (GET/PUT)
data/meta.json  ◀── 置顶/标签/排序/备注（sidecar，绝不影响主库）
src/  ──▶ 左列表(Sidebar) + 右详情(Transcript + Toc) 
```

原则：**读主库只读；写主库仅 `session.title`；其余一切写 sidecar。**

## 4. 数据与存储设计

### 4.1 Sidecar：`data/meta.json`（新增）
以 opencode `session.id` 为键：
```jsonc
{
  "ses_xxx": {
    "pinned": true,
    "pinOrder": 0,          // 置顶内排序
    "order": 12,            // 列表自定义排序（可选）
    "tags": ["工作", "重要"],
    "note": "……",
    "titleOverride": null   // 可选：仅为显示，不写主库（默认 null，不用）
  }
}
```
- 小体量（~389 会话）→ 单文件足够；写入用**原子替换**（写临时文件 + rename），并做 200ms 去抖。
- 与主库解耦：主库 session 变化（含被删除）不影响读取，仅孤儿记录，定期清理。
- `data/` 加入 `.gitignore`。

### 4.2 TOC 数据来源
- 不额外存储，**按需从主库派生**：某 session 内 `message.data.role='user'`、按 `time_created` 排序，取其 `part.type='text'` 文本。
- 每章一条：`{ seq, messageId, createdAt, preview(前80字), text(全文) }`。
- （可选 v2）若需全文检索加速，再引入 `data/index.db`（FTS5）；v1 先用基线内存搜索。

### 4.3 改名（唯一写主库）
- 单点实现于 `server/rename.js`：以**读写**连接打开 `opencode.db`，仅执行
  `UPDATE session SET title = ? WHERE id = ?`。
- 约束：`id` 必须匹配 `^ses_[A-Za-z0-9]+$`；`title` 长度上限（如 200）并去控制字符。
- **不改 `time_updated`**（避免在 opencode/TUI 中把该会话顶到最前）。
- 设置 `busy_timeout`；失败回滚并返回明确错误。
- 已知副作用：正在运行的 TUI 内存缓存不会实时刷新，需重载会话才可见（文档中注明）。

## 5. 后端改造清单（文件级）

### 5.1 修改
- **`server/sources/index.js`**
  - 只保留 `opencode` 适配器注册；`listConversations()` 仍保留聚合接口形状（单源）。
  - `getConversation` 透传分页参数。
- **`server/sources/opencode.js`**（核心）
  - `list()`：SELECT 增补 `agent, model, cost, tokens_input/output`，并**挂载 sidecar 元数据**（pinned/tags/order）；过滤空会话逻辑保留。
  - `detail(ref, { limit, before })`：支持**全量或分页**返回，消息带 `{ role, messageId, createdAt, parts[] }`（结构化，便于跳转与高亮），不再固定 lastN=30。
  - 新增 `toc(ref)`：返回用户提问章节数组（见 4.2）。
  - 保持 `ses_` 正则校验与只读连接。
- **`server/sources/_shared.js`**
  - `SOURCE_META` 精简为仅 `opencode`（或保留，不强删）。
  - `makeEntry` 增补可选字段：`pinned, tags, order`。
- **`vite.config.js`**
  - 端口 5191 → **4570**（dev + preview）。
  - 新增端点（见 §5.3）；移除 `/api/agents*`、`/api/usage` 路由。
- **`src/sortConvos.js`**
  - 排序前**置顶优先**；支持 `pinned` 内置排序项与 `order` 自定义排序；移除 `tool` 排序（单源无意义），保留 recent/oldest/messages/title。

### 5.2 新增
- **`server/meta.js`**：sidecar 读写（原子、去抖），导出 `getMeta`, `putMeta(sessionId, partial)`, `listMeta()`。
- **`server/rename.js`**：唯一写主库函数（见 4.3）。
- **`src/SessionDetail.jsx`**：右侧详情面板（正文 + 头部操作）。
- **`src/Toc.jsx`**：目录侧栏，点击滚动定位到对应 user 消息。
- **`src/Sidebar.jsx`**：（可选）把列表从 `App.jsx` 拆出，承载搜索/过滤/置顶/标签。
- **`src/TagEditor.jsx`**：标签增删 + 备注编辑。
- **`data/.gitkeep`**：数据目录占位。

### 5.3 API 契约（目标）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/conversations` | 列表（含 pinned/tags/order） |
| GET | `/api/conversation?source=opencode&ref=&limit=&before=` | 会话详情（全量/分页） |
| GET | `/api/toc?ref=` | 用户提问目录 |
| GET/PUT | `/api/meta`（GET 全量 / PUT `?ref=`） | 读取/写入置顶·标签·排序·备注 |
| PATCH | `/api/rename?ref=&title=` | 改 opencode session 标题（写主库） |
| GET | `/api/search?q=` | 全文搜索（沿用基线） |
| GET | `/api/open?path=` | 打开目录（沿用） |

### 5.4 移除
- `server/sources/{claude,codex,grok,cursor,gemini,copilot,goose,droid}.js`
- `server/agents.js`、`server/usage.js`
- `src/Agents.jsx`、`src/Usage.jsx`、`src/Metrics.jsx`、`src/MiniStats.jsx` 及对应 css
- 多源相关 UI：工具 chips、按 source 的项目过滤联动

## 6. 前端重构（`src/App.jsx` → 双栏）

### 6.1 布局
- 顶部：搜索框 + 排序下拉 + 手动刷新按钮（去掉 Agents/Stats）。
- 左栏：会话列表（置顶区在最上，其余按所选排序）；每项显示标题、目录、时间、消息数、标签、置顶星标。
- 右栏：选中会话的详情，含：
  - 头部：标题（**可点击改名**）、目录路径、resume 命令复制、置顶/标签/备注操作。
  - **目录（TOC）**：用户提问列表，点击滚动定位到正文对应位置。
  - 正文：完整转录（user/assistant，含工具调用内联样式，沿用 `segmentText`）。

### 6.2 交互与状态
- 选中/切换会话 → 拉取 `detail` + `toc`（即"切换时刷新"）。
- 改名：行内编辑 → `PATCH /api/rename` → 成功后本地更新标题。
- 置顶/标签/排序/备注：调用 `PUT /api/meta`；列表即时重排（置顶优先）。
- 搜索：沿用基线元数据 + 内容搜索联动（保留 `highlight`）。
- **移除**对 `ccv.starred` localStorage 的依赖（迁移到服务端 `/api/meta`）；可保留一次性迁移逻辑（首次把本地 star 并入 sidecar）。

### 6.3 需保留的基线能力
- 增量渲染（`limit` + IntersectionObserver）保留。
- 焦点/可见性触发的静默刷新保留（与"手动刷新"不冲突）。
- `highlight`、相对时间、`CopyButton`、`OpenButton` 复用。

## 7. 刷新策略
- 手动：顶部 `⟳` 调 `loadConversations(true)`。
- 切换会话：进入详情时重新拉 `detail` + `toc`。
- 不做文件监听 / SSE / 轮询（按决定）。

## 8. 安全与边界
- 服务仅绑 `localhost`，禁止 `--host`（沿用基线约束，写进 README）。
- 只读连接读主库；写连接仅用于 `UPDATE session.title`，集中于 `rename.js`。
- sidecar 是唯一持久化自有状态处；不新增其他对主库的写。
- `ref` 一律用 `ses_` 正则校验；`/api/open` 沿用路径校验。
- WAL 只读异常时：`busy_timeout`，必要时降级为普通连接只跑 SELECT。

## 9. 分阶段实施与验收

- **P0 精简基线**：删多源/Agents/Usage/Metrics，端口改 4570，`/api/conversations` 只剩 opencode。
  验收：`npm run dev` 打开列表仅显示 opencode 会话，无残留报错。
- **P1 sidecar 元数据**：`server/meta.js` + `/api/meta`（GET/PUT）；`list()` 挂载 pinned/tags/order。
  验收：置顶/打标签后刷新仍在；**openode 主库 `session` 行零改动**（对比 `time_updated` 不变）。
- **P2 详情 + TOC**：`detail` 全量/分页 + `/api/toc` + 双栏 UI + 定位跳转。
  验收：任选长会话，目录条数=用户消息数，点击定位正确。
- **P3 改名**：`server/rename.js` + `PATCH /api/rename` + 行内编辑。
  验收：改名后主库 `session.title` 变更、`time_updated` 不变；重启 TUI 可见新标题。
- **P4 排序/搜索收口**：置顶优先 + 自定义排序；搜索覆盖标题/目录/路径/正文。
  验收：置顶恒在最上；搜索结果可定位到来源会话。

每阶段完成跑 `npm test`（需同步裁剪 smoke-test 中对已删源的依赖）。

## 10. 风险与对策
| 风险 | 对策 |
|---|---|
| Node 22 vs 24（`node:sqlite` 实验性） | 可接受；如需消除告警可升级 Node 24 或加 `--no-warnings` |
| 主库 WAL 只读锁 | `busy_timeout` + 异常降级只跑 SELECT |
| 改名被运行中的 opencode 内存态覆盖 | 文档注明需重载；后续可评估改走 `opencode serve` API（P5 可选） |
| 主库 schema 升级 | 读取集中 `opencode.js` 单点，失败即降级返回空并告警 |
| 全量转录性能 | 分页（`limit/before`）+ 前端虚拟/增量渲染 |
| 孤儿 sidecar 记录 | 每次 `list()` 后清理已不存在的 session id |
| 上游变更 | 保留 `upstream` 远程，便于 cherry-pick |

## 11. 文件总表
- **新增**：`IMPLEMENTATION.md`(本文)、`server/meta.js`、`server/rename.js`、`src/SessionDetail.jsx`、`src/Toc.jsx`、`src/TagEditor.jsx`、`src/Sidebar.jsx`(可选)、`data/.gitkeep`
- **修改**：`server/sources/index.js`、`server/sources/opencode.js`、`server/sources/_shared.js`、`vite.config.js`、`src/App.jsx`、`src/sortConvos.js`、`scripts/smoke-test.mjs`、`README.md`、`.gitignore`
- **删除**：`server/sources/{claude,codex,grok,cursor,gemini,copilot,goose,droid}.js`、`server/agents.js`、`server/usage.js`、`src/Agents.jsx`、`src/Usage.jsx`、`src/Metrics.jsx`、`src/MiniStats.jsx` 及其 css、`public/` 中未用资源（保留 PWA 可选）

## 12. 待确认（实施前）
1. 列表/详情是否用**双栏**（推荐），还是保留基线卡片展开式？
2. sidecar 用 `data/meta.json`（推荐，简单）还是直接上 `data/index.db`(FTS5)？
3. 搜索 v1 沿用基线内存搜索（首搜慢）是否可接受，还是首版就上 FTS5？
4. 改名后是否需要**刷新提示**（如"重启 TUI 后可见"）toast？
5. 端口最终确认 4570？（与基线 5191 二选一）
