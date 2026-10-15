# Agent API（机器接口）

> 本文件与项目仓库 `docs/AGENT-API.md` 同步，是该机器接口契约的完整副本。

除人工界面外，本项目对 AI Agent 提供一套**只读**、本机、无鉴权的访问方式，返回紧凑、稳定的 JSON，并带回到人工界面的深链（deepLink）。它复用人工界面同一套数据层（`server/archive.js`），只是换了一层面向机器的契约。

- **CLI**：`ocde`，默认直读本地数据库，无需服务常驻。
- **HTTP**：`/api/agent/*`，挂在现有本地服务（默认 `http://127.0.0.1:4570`）。

两套输出共享同一契约（`schemaVersion: 1`）。

## 为什么需要它

opencode 官方提供了 `session list` / `export` / `serve`（OpenAPI）/ SDK，但**没有跨会话全文检索**，也不提供聚合视图、token 友好的紧凑转录、会话内查找和提问目录。本接口补齐这些缺口，让 Agent 用一次调用拿到“够用的历史上下文”，而不必自己 grep 数据库。

## CLI

安装（可选，使其成为全局命令）：

```bash
npm link        # 之后可直接用 ocde
# 或不经安装
node bin/ocde.mjs <command>
npm run agent -- <command>
```

命令：

| 命令 | 说明 |
|---|---|
| `ocde path` | 显示服务地址与数据库路径 |
| `ocde projects [--limit N]` | 项目列表 |
| `ocde recent [--project P] [--dir D] [--limit N] [--with-question]` | 最近的会话 |
| `ocde search "<q>" [--scope all\|metadata\|content] [--project P] [--limit N] [--sort recent\|relevance]` | 跨会话检索（官方缺口） |
| `ocde show <id> [--limit N] [--max-chars N] [--cursor C] [--full]` | 紧凑转录，默认返回最新一页 |
| `ocde toc <id>` | 用户提问目录 |
| `ocde find <id> "<q>"` | 会话内查找 |
| `ocde resume <id>` | 打印恢复命令 |

约定：

- 默认**直连数据库核心**；加 `--http` 改走正在运行的服务（更快，但需服务在线）。
- 输出：TTY 下是人类可读格式；管道或 `--json` 下输出 JSON（便于 `jq`）。
- 退出码：`0` 成功 / `2` 用法错误 / `1` 运行错误。

示例：

```bash
ocde search "支付回调" --limit 5 --json | jq '.hits[].deepLink'
ocde recent --dir /home/me/proj --limit 3
ocde show ses_xxx --limit 20 --max-chars 8000 --json
```

## HTTP

基址 `http://127.0.0.1:4570`（可用 `OCDE_SERVICE_URL` 覆盖 deepLink 中记录的地址）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/agent/health` | 服务/数据库状态 |
| GET | `/api/agent/projects?limit=` | 项目列表 |
| GET | `/api/agent/recent?project=&dir=&limit=&withQuestion=` | 最近会话 |
| GET | `/api/agent/search?q=&scope=&project=&limit=&sort=` | 跨会话检索 |
| GET | `/api/agent/sessions/:id?limit=&maxChars=&cursor=&full=` | 紧凑转录 |
| GET | `/api/agent/sessions/:id/toc` | 提问目录 |
| GET | `/api/agent/sessions/:id/find?q=` | 会话内查找 |
| GET | `/api/agent/sessions/:id/meta` | 单会话元数据（含恢复命令） |

```bash
curl -s "http://127.0.0.1:4570/api/agent/search?q=opencode&limit=3"
```

## JSON 契约

统一信封：`{ "schemaVersion": 1, "kind": "...", ... }`。

- `health`：`{ ok, serviceUrl, dbPath, dbExists }`
- `projects`：`{ total, count, projects:[{ id, name, identitySource, worktree, paths, sessionCount, lastActivity, pinned, deepLink }] }`
- `recent`：`{ count, sessions:[{ id, title, projectId, identitySource, directory, updatedAt, messageCount, pinned, resume, deepLink, firstQuestion? }] }`
- `search`：`{ query, scope, sort, total, truncated, hasMore, nextCursor, hits:[{ sessionId, projectId, messageId, matchField, snippet, title, updatedAt, deepLink }] }`
- `show`：`{ session:{ id, title, projectId, directory, resume, deepLink }, count, messages:[{ id, role, at, text, tools? }], truncated, hasMore, nextCursor }`
- `toc`：`{ sessionId, count, items:[{ seq, messageId, createdAt, preview, deepLink }] }`
- `find`：`{ sessionId, query, count, hits:[{ seq, messageId, snippet, deepLink }] }`
- `resume`：`{ id, directory, command, shell? }`

deepLink 规则：

- 会话：`/projects/<projectId>/sessions/<id>`
- 检索命中：`/all/sessions/<id>?message=<messageId>`
- 项目：`/projects/<projectId>`

## 边界与安全

- **只读**：不暴露置顶/标签/别名/改名等写操作。
- **仅本机**：服务仍绑定 `localhost`；不提供鉴权，请勿对外暴露。
- **输入校验**：会话 id 复用 `^ses_[A-Za-z0-9]+$`；`limit` 夹在 1–200（`show` 为 1–100），`maxChars` 夹在 500–200000。
- **性能**：`projects` 有 60s 进程内缓存；`recent`/`show` 使用廉价查询，避免全量聚合。

## 与人工界面的关系

人工界面走 `/api/archive/*`（保留不变），机器接口走 `/api/agent/*`，二者共享 `server/archive.js` 与 sidecar，契约相互独立。
