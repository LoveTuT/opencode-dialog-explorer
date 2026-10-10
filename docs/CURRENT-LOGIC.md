# opencode Dialog Explorer：现状逻辑梳理

> 本文记录当前实现的页面结构、数据流和交互行为，作为维护时的事实参考。早期设计与取舍仍见 [`IMPLEMENTATION.md`](./IMPLEMENTATION.md)；视觉 token 见 [`FRONTEND-DESIGN.md`](./FRONTEND-DESIGN.md)。

## 1. 产品边界

这是一个仅绑定 localhost 的 OpenCode 历史档案浏览器：

1. 从项目列表进入项目上下文。
2. 在项目内筛选、排序和分页浏览会话。
3. 在阅读器中查看消息、工具调用、reasoning、提问索引和会话内查找结果。
4. 在「全部记录」中跨项目搜索并跳转到具体消息。
5. 复制恢复命令、Session ID、代码块、工具输入/输出或 reasoning。
6. 通过 sidecar 保存置顶、排序、别名、标签和备注；会话标题单独写入 OpenCode 主库。

应用不创建会话，不提供聊天输入框，不做云同步，不删除或跨项目迁移 OpenCode 数据。

## 2. 页面与导航

| 页面/区域 | 当前行为 |
|---|---|
| 项目总览 | 展示项目统计、项目卡片和路径；不预先展开全部会话详情。 |
| 项目页 | 展示项目资料、目录筛选、会话排序/筛选和服务端分页列表；会话列表每页默认 30 条，支持「加载更多」。 |
| 阅读器 | 展示当前会话的一页消息；可加载更早消息、查看提问索引、查找、复制和编辑会话信息。 |
| 全部记录 | 展示项目/路径索引与跨项目搜索；支持全部、标题与路径、正文三个范围，正文命中带消息锚点。 |
| 已置顶 | 汇总置顶项目和会话；置顶项可以在置顶组内拖动或用上下按钮调整顺序。 |
| 左侧导航 | 在项目、全部记录、已置顶和项目快捷入口之间切换；窄屏时变为可展开浮层。 |

当前路由状态由前端页面状态管理；项目、会话和搜索结果的深链由应用现有路由逻辑处理。未知记录会显示缺失状态，不自动改跳到其他会话。

## 3. 主要数据流

```text
OpenCode SQLite（读连接）
        │
        ├─ server/archive.js
        │       ├─ 项目索引与会话摘要
        │       ├─ 项目会话分页
        │       ├─ 会话消息分页
        │       ├─ TOC / around / session find
        │       └─ 全局搜索
        │
        ├─ server/rename.js ── 仅写 session.title
        └─ server/meta.js ──── data/meta.json sidecar
                                  │
                                  └─ 置顶、order、alias、tags、note

React（src/App.jsx）
        │
        ├─ 项目/会话列表
        ├─ 阅读器与提问索引
        ├─ 全局搜索与会话内查找
        └─ 管理弹窗、复制操作、错误反馈和焦点管理
```

项目优先使用 `project.id` 作为稳定身份；缺少项目表或 `project_id` 时回退到规范化目录的 `dir:<sha1>` 身份，并暴露 `identitySource`。会话保留真实 `session.directory`，目录筛选按完整路径匹配，不按最后一段名称合并。

## 4. 阅读器逻辑

- 会话详情按复合游标分页，前端按时间正序展示；「加载更早」请求下一页，不把分页数据伪装成一次性全文。
- 消息保留用户、助手、工具和 reasoning 类型。工具输入/输出与 reasoning 使用可展开面板。
- 提问索引只取用户消息，使用稳定 `messageId` 定位；目标不在当前页时，请求 `around` 窗口后再滚动。
- 会话内查找请求 `/api/archive/sessions/:id/find`，返回命中消息和片段；结果支持上一处/下一处，Markdown 命中用 `<mark>` 高亮。
- 阅读区提供「仅问答」过滤。查找期间会临时展示被过滤的命中消息，避免定位失败。
- 代码块、工具输入、工具输出和 reasoning 都提供复制按钮；复制成功或失败都会显示文本 toast。
- 可复制恢复命令和 Session ID；目录打开动作只代表已发起本地打开命令，不能保证外部程序实际打开成功。

## 5. 管理与失败反馈

### Sidecar 数据

`data/meta.json` 保存：

- `projects[id]`：`pinned`、`alias`、`note`、`order`。
- `sessions[id]`：`pinned`、`tags`、`note`、`order`。

置顶排序只影响本应用展示，不修改 OpenCode 主库；写入失败时乐观 UI 会回滚。sidecar 写入串行化并做字段校验。

### 会话信息

会话信息弹窗集中编辑标题、标签和备注：

- 标题写入 OpenCode 的 `session.title`。
- 标签和备注写入 sidecar。
- 标题与 sidecar 保存是两次写入，不是跨存储原子事务。
- 任一写入失败时弹窗保持打开，草稿保留并显示错误；若标题已成功而 sidecar 失败，会明确提示部分成功。
- 原地标题编辑失败时同样保留编辑态。

弹窗实现了 `aria-labelledby`、打开时聚焦首个输入、Tab 焦点循环、Esc/蒙层关闭和关闭后归还触发按钮焦点。全局 `/` 与 `Ctrl/Cmd+K` 快捷键会避开输入控件和内容可编辑区域。

## 6. 当前 API 契约

所有应用接口使用 `/api/archive/*` 命名空间：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/archive/index` | 项目索引、会话摘要、首条用户提问 |
| GET | `/api/archive/projects/:id/sessions` | 项目内分页、排序、目录/文本筛选 |
| GET | `/api/archive/sessions/:id` | 会话消息分页 |
| GET | `/api/archive/sessions/:id/toc` | 用户提问索引 |
| GET | `/api/archive/sessions/:id/around` | 按消息 ID 加载前后窗口 |
| GET | `/api/archive/sessions/:id/find` | 当前会话全部消息查找 |
| GET | `/api/archive/search` | 跨项目元数据/正文搜索，返回消息级命中 |
| GET/PUT | `/api/archive/meta/projects/:id`、`/api/archive/meta/sessions/:id` | sidecar 字段更新 |
| POST | `/api/archive/meta/order` | 批量保存置顶项顺序 |
| PATCH | `/api/archive/sessions/:id/title` | 写入会话标题 |
| GET | `/api/open?path=` | 发起本地目录打开命令 |

旧的 `/api/conversations`、`/api/conversation`、`/api/search` 以及旧搜索模块已移除。正文搜索使用带边界的 SQL 扫描，`SEARCH_CAP=1000`；超出上限时返回 `truncated`，当前没有独立磁盘全文索引或 FTS5。

## 7. 当前视觉与响应式行为

- 当前生效主题在 `src/theme.css`：白色表面、近白画布、炭灰文字、低饱和石板蓝强调。
- 主要阅读正文最大宽度约 800px；代码块和长工具输出在自身区域滚动。
- `≤1370px` 提问索引向阅读区收拢；`≤920px` 导航和会话栏收窄；`≤640px` 导航变为浮层、项目会话列表与正文逐屏切换；`≤320px` 筛选控件换行。
- `prefers-reduced-motion: reduce` 会减少过渡与滚动动画。
- 触摸提问索引采用首次点按预览、再次点按跳转的逻辑。

详细颜色、字体和 CSS 落点以 [`FRONTEND-DESIGN.md`](./FRONTEND-DESIGN.md) 与 `src/theme.css` 为准。

## 8. 当前实现落点

- 前端交互集中在 `src/App.jsx`，基础样式和主题样式分别位于 `src/index.css` 与 `src/theme.css`。
- 归档数据访问集中在 `server/archive.js`，sidecar 管理位于 `server/meta.js`，会话标题写入位于 `server/rename.js`。
- 搜索、分页、提问索引、定点窗口、复制操作、会话信息编辑和响应式布局均按当前页面逻辑工作。
- 视觉 token 与主题约定见 [`FRONTEND-DESIGN.md`](./FRONTEND-DESIGN.md)；早期设计背景与历史决策见 [`IMPLEMENTATION.md`](./IMPLEMENTATION.md)。
