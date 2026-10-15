---
name: opencode-dialog-explorer
description: opencode 会话历史档案（opencode-dialog-explorer）的部署与只读查询入口。当用户要查询/检索/浏览 opencode 的会话内容或对话历史、跨会话全文搜索、按项目或大致会话名找回历史、查看某条消息、复制恢复命令（resume/继续会话），或要通过 ocde CLI、dialog-explorer 本地服务（端口 4570）、/api/agent/* HTTP 接口访问 opencode 数据，或要部署、启动、重启、停止、npm link 这个查看器时使用。路由边界：opencode 自身配置/provider/MCP/升级用 opencode-manager；注册项目的后台进程启停优先 project-runtime-manager；本 skill 只管“读取 opencode 会话数据”和“运行这个查看器服务”。只读，不修改会话。
compatibility: opencode
---

# opencode Dialog Explorer

对本地 **opencode** 会话数据库的**只读**档案/检索工具。项目名 `opencode-dialog-explorer`，Agent 命令 `ocde`，本地服务端口 `4570`。它补齐 opencode 官方缺失的**跨会话全文检索**、聚合视图、token 友好转录、会话内查找与提问目录。

## 边界（先读）

- **只读**：不创建/修改/删除会话，不写 opencode 主库。人工界面唯一例外是“重命名标题”，Agent 不要用。
- **仅本机**：服务绑定 `localhost`，无鉴权；**绝不要加 `--host` 对外暴露**。
- **不在本 skill 范围**：opencode 配置/provider/MCP/升级（→ `opencode-manager`）；项目后台进程通用启停框架（→ `project-runtime-manager`）；提交/推送（→ `git-ops` / `git-manager`）。
- **术语**：`项目(project)` 由 opencode `project_id` 标识（形如 `project:<hash>`，无项目表时回退 `dir:<sha1>`）；`会话(session)` id 形如 `ses_...`。两者都带 `deepLink` 回跳人工界面。

## 定位环境（跨平台，别硬编码路径）

运行时路径一律用命令查，不写死：

```bash
ocde path        # -> { serviceUrl, dbPath, dbExists }  ← 服务地址与数据库路径，按当前操作系统自动解析
```

- `ocde` 安装后（见「部署 · npm link」）在 PATH 上，Windows / macOS / Linux 通用。
- 未安装时等价调用：在仓库根执行 `node bin/ocde.mjs ...`，或 `npm run agent -- ...`。**仓库根 = 含 `bin/ocde.mjs` 的目录**（本机示例：`/home/wanghj/projects/projects-self/opencode-dialog-explorer`，下称 `<REPO>`）。
- 数据库路径遵循 opencode 的 XDG 约定（三端一致）：`$XDG_DATA_HOME`（绝对路径时）或 `<家目录>/.local/share` 下的 `opencode/opencode.db`。**直接信 `ocde path` 输出，不要自己拼路径。**

## 访问 opencode 会话内容的途径

按优先级选，能用前面的就别用后面的。

| 途径 | 何时用 | 前置 |
|---|---|---|
| **A. `ocde` CLI（默认直读 DB）** | **首选**。查/搜/看历史，脚本化、管道接 `jq` | Node 22+ 且已 `npm install`；**不需要服务** |
| **B. `ocde --http` / `curl /api/agent/*`** | 需要常驻 HTTP 端点供别的进程调用 | 4570 服务在运行 |
| **C. opencode 官方 CLI** | 需要官方导出/删除会话等本工具不做的事 | 已安装 opencode |
| **D. 直接读 SQLite（兜底）** | **仅当 A/B/C 都不可用、服务也起不来时**，最后手段 | `sqlite3` 或 `node:sqlite` |

### A. ocde CLI（首选）

命令见下节「CLI 速查」。默认直读数据库，零服务依赖。

### B. HTTP 接口（/api/agent/*）

服务在 4570 运行时：

```bash
ocde --http search "关键词" --limit 5          # CLI 走服务
curl -s "http://127.0.0.1:4570/api/agent/search?q=关键词&limit=5"
curl -s "http://127.0.0.1:4570/api/agent/health"
```

端点：`/api/agent/{health,projects,recent,search}` 与 `/api/agent/sessions/:id[/toc|/find|/meta]`。完整契约见 `references/agent-api.md`。

### C. opencode 官方 CLI

```bash
opencode session list                 # 列出会话（无跨会话全文检索、无聚合视图）
opencode export <sessionID>           # 导出单个会话 JSON
opencode db path                      # 打印数据库路径
opencode db "<SQL>" --format json     # 直接跑 SQL
opencode serve                        # headless server / OpenAPI
```

局限：**没有跨会话全文检索**、没有紧凑转录、没有会话内查找/提问目录。要这些功能就用 A/B。

### D. 直接读 SQLite（最后兜底）

仅在前三条都失效、且 4570 服务无法启动时使用：

```bash
opencode db "SELECT id,title,time_updated FROM session WHERE parent_id IS NULL ORDER BY time_updated DESC LIMIT 20" --format json
# 或用系统 sqlite3 / node:sqlite 只读打开 `ocde path` 给出的 dbPath
```

注意：会话正文存在 `message` / `part` 表的 `data`（JSON）列里；**schema 可能随 opencode 版本变化**，且要**只读打开**。能启动服务时优先用 A/B。

## CLI 速查

```text
ocde path                     服务地址 + 数据库路径
ocde projects [--limit N]     项目列表
ocde recent   [--project P] [--dir D] [--limit N] [--with-question]
ocde search "<q>" [--scope all|metadata|content] [--project P] [--limit N] [--sort recent|relevance]
ocde show <id> [--limit N] [--max-chars N] [--cursor C] [--full]
ocde toc <id>                 用户提问目录
ocde find <id> "<q>"          会话内查找
ocde resume <id>              打印恢复命令
```

- 通用选项：`--json`（输出 JSON；管道下默认即 JSON）、`--http`（改走运行中的服务）、`-h/--help`。
- 输出：TTY 下人类可读；管道或 `--json` 下为机器 JSON（信封 `schemaVersion:1`）。
- 退出码：`0` 成功 / `2` 用法错误 / `1` 运行错误。

实测示例：

```bash
ocde search "风巡" --limit 10 --json | jq '.hits[] | {title, deepLink}'
ocde recent --limit 5
ocde toc  ses_f7bfd71f9ffehPot4gHwPLa0cf
ocde find ses_f7bfd71f9ffehPot4gHwPLa0cf "配置"
ocde show ses_f7bfd71f9ffehPot4gHwPLa0cf --max-chars 8000 --json
ocde resume ses_f7bfd71f9ffehPot4gHwPLa0cf
```

## 常用结果字段（信封 `schemaVersion:1`）

- `search`：`total / truncated / hasMore / nextCursor / hits[{ sessionId, projectId, messageId, matchField, snippet, title, updatedAt, deepLink }]`
  - `matchField` = `title|project|path|tags|note|id`（元数据命中，`messageId:null`）或 `content`（正文命中）。
- `recent`：`sessions[{ id, title, projectId, directory, updatedAt, messageCount, resume, deepLink }]`
- `show`：`session{...}` + `messages[{ id, role, at, text, tools? }]` + `truncated / hasMore / nextCursor`
- `toc`：`items[{ seq, messageId, createdAt, preview, deepLink }]`
- `find`：`hits[{ seq, messageId, snippet, deepLink }]`
- `resume`：`{ id, directory, command }`
- `deepLink` 规则：会话 `/projects/<projectId>/sessions/<id>`；命中 `/all/sessions/<id>?message=<messageId>`；项目 `/projects/<projectId>`。基址 = `serviceUrl`（可用环境变量 `OCDE_SERVICE_URL` 覆盖）。

## 部署

**前置**：Node.js 22+（`node:sqlite`）；已存在 opencode 数据库。

```bash
cd <REPO>
npm install                          # 首次
```

**前台开发**（会打开浏览器）：

```bash
npm run dev                          # http://localhost:4570
```

**后台服务**（构建 preview 并常驻，**Agent 推荐用这个**）：

```bash
npm run service:start                # 构建并后台运行
npm run service:status               # 查看是否运行 / 端口归属
npm run service:restart              # 改代码后重建并重载
npm run service:stop                 # 只停本脚本启动的实例
```

- Windows 也可双击 `service/start.cmd` / `service/stop.cmd`；macOS/Linux/WSL 可用 `sh service/start.sh` / `sh service/stop.sh`。
- `start` 会**复用**已在运行的服务、**不重载代码**；改完代码一律 `service:restart`。
- **4570 端口只能有一个 owner**：`npm run dev`（前台）与 `npm run service:start`（后台）互斥，别同时开。

**让 `ocde` 全局可用（npm link）**：

```bash
cd <REPO>
npm link                             # 在全局 bin 建软链，之后任何目录直接 ocde
npm unlink -g opencode-dialog-explorer   # 卸载
```

**跨平台注意**：
- 一律用 `npm run ...` 与 `ocde`，不要写死 shell 类型；`.cmd` 仅 Windows、`.sh` 仅 macOS/Linux/WSL。
- WSL 与原生 Windows 是**各自独立的副本与数据库**，不要在两者间共享 `node_modules`；在哪运行就读哪的 opencode 数据。
- `ocde resume` 会按当前平台生成恢复命令（POSIX shell 或 PowerShell）。

## Agent 工作流配方

1. **只有大致会话名，要找回内容**：
   `ocde search "<关键词>"` → 命中里取 `sessionId`（同时给出 `title` 与 `deepLink`）→ `ocde toc <id>` 看提问目录 → `ocde show <id> --max-chars 6000`。
2. **定位会话内某个点**：`ocde find <id> "<词>"` → 用返回的 `deepLink` 打开对应消息。
3. **要继续这个会话**：`ocde resume <id>` 得到 `opencode '<目录>' --session <id>`，复制执行。
4. **枚举/筛选**：`ocde projects`；`ocde recent --project <projectId> --limit 10`；按目录 `--dir <path>`。
5. **控 token**：`show` 用 `--limit` + `--max-chars` 截断，`--cursor` 往前翻；只有确实需要 reasoning 时才加 `--full`。

## 验证

```bash
npm test                             # smoke + archive + agent 契约
npm run build
ocde path                            # 服务/DB 状态
curl -s http://127.0.0.1:4570/api/agent/health   # 服务在运行时
```

## 坑与边界

- `node:sqlite` 会打印 `ExperimentalWarning`，**属正常**。
- 正文搜索是**有上限的 SQL 扫描**（`SEARCH_CAP=1000`）；命中过多时返回 `truncated:true`。
- `projects` 有 **60s 进程内缓存**，刚发生的变更可能延迟一会儿才出现。
- `ocde` 默认直读 DB，**不需要服务**；只有 `--http` 或 B 途径才要求 4570 在线。
- 会话 id 校验 `^ses_[A-Za-z0-9]+$`；`limit`/`maxChars` 有上下限，越界会被夹紧。
- 完整机器契约与字段定义见 [`references/agent-api.md`](./references/agent-api.md)（与仓库 `docs/AGENT-API.md` 同步）；现状逻辑见仓库 `docs/CURRENT-LOGIC.md`。
