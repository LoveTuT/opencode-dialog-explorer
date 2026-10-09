# opencode Dialog Explorer：项目优先的 UI / 交互重构方案

> 状态：设计与实施规格；项目优先界面及核心阅读/检索能力已实现，详见文末「实施进度与差距」。调研日期：2026-10-08，2026-10-09 更新：提问索引最终形态（紧凑「琴键」+ hover/聚焦预览）、会话内查找（`<mark>` 高亮 + 上/下一处）、会话列表首问摘要与服务端分页、旧 API 收敛（仅保留 `/api/archive/*`）、消息级多命中检索、`around` SQL 定点窗口、目录回退身份（`dir:<hash>` + `identitySource`）已落地。[早期实施规划](./IMPLEMENTATION.md) 保留历史决策与 P0 记录，冲突时以本文为准。

## 1. 定位与设计哲学

**产品一句话**：将本机 opencode 历史整理成可按项目回顾、按会话阅读、跨项目深度找回的个人工作档案。这里的「项目」不是在网页中启动的新工作空间；数据来自已有 opencode 记录。

**用户路径**：找到项目 → 找到一次工作的会话 → 浏览提问与回复 → 定位原文 / 复制恢复命令；不记得项目时走「全部记录」搜索。

从 ChatGPT（原 Codex）桌面客户端借鉴的是**项目与聊天的层级、固定高频项、跨项目搜索、聚焦阅读**，不是它的对话输入框、任务执行、云端同步或视觉资产。官方项目文档把长期、多输出的工作归为项目，并在项目内保留独立聊天；支持项目/聊天置顶、重命名和全局 Search chats；官方概览提供侧边栏 / Pinned / Projects / Recents 的公开界面样本。这里将项目入口提升为主导航，让「全部记录」成为明确而强大的第二入口，不让 389+ 张会话卡片淹没首页。参考链接见文末。

原则：

1. **项目是默认上下文，会话是最小阅读单位**：先定位归属，再展示项目内会话；全局检索可以打破层级。
2. **发现和阅读分工**：左边浏览范围，中间选会话，右边连续阅读；宽度不足时逐层进入，避免三列挤压正文。
3. **档案而非聊天器**：不放假的输入框或「新建会话」按钮；提供复制恢复命令、打开本地目录。
4. **真实来源可追溯**：项目别名、标签、置顶属于本应用；显示清楚主库项目、会话目录和原始 session id；任何改名操作明确标示其写入范围。
5. **渐进披露**：默认看标题、活动时间、首段预览及问答；技术过程（工具输出 / reasoning）折叠，仍可展开查看；绝不默默把转录截为 30 条而称「全文」。
6. **轻量、克制、有辨识度**：用比例、层次、文字与留白，而非模仿品牌 Logo、花哨统计或虚构状态。

## 2. 重构前基线与设计依据（历史）

> 下表记录 2026-10-08 调研时的**重构前基线**，用于说明改造动机；其中「现状」一列多数已在实施中替换（数据/列表/详情/搜索/管理/刷新均已改造），当前实现见 §10。

| 维度 | 重构前基线 | 改造原因 |
|---|---|---|
| 数据 | `server/sources/opencode.js` 只列顶层、非空会话；按 `session.directory` 的最后一段生成 `projectLabel` | 同名目录可能撞名；同一项目可能有不同工作目录 |
| 列表 | `/api/conversations` 返回全部会话，`src/App.jsx` 单页卡片与项目下拉筛选 | 无项目级首页 / 项目导航 / 可复制的深链接 |
| 详情 | `/api/conversation` 固定最近 30 条，`Message` 混合文本、tool、reasoning 标记 | 无完整连续阅读 / 稳定消息锚点 / 提问目录 |
| 搜索 | 元数据客户端即时过滤，`server/search.js` 缓存每会话最近 30 条合计前 4000 字符的小写文本 | 当前「全文」并非全会话，无法定位命中消息 |
| 管理 | 星标与筛选存 `ocde.*` localStorage；主库只读；没有项目元信息 | 置顶、标签、备注和项目别名应跨浏览器在 sidecar 生效 |
| 刷新 | 手动刷新、焦点 / 可见性恢复超过 30 秒时静默刷新；展开卡片后缓存详情 | 需要保证切换会话重新取数、搜索结果不会保留过期预览 |

本机 2026-10-08 **只读查询**样本：顶层会话 390 个（包含 1 个空会话；接口冒烟测试返回 389 个），`session.directory` 去重为 47 个，`session.project_id` 去重为 18 个；10 个 project_id 对应多个 directory，另有 1 个 directory 对应多个 project_id。样本仅用于发现模型边界，**不能假设其他机器数字一致**。主库实际有 `project(id, worktree, name, …)` 表及 `session(project_id, directory, parent_id, …)` 字段；需要兼容版本差异并在开发前再确认 join 能力。UI 不应使用 `projectLabel` 做 ID，也不能把同名目录自动合并。

既定边界沿用早期规划：仅本地 opencode 数据；主库读取原则上只读；如后续实施会话改名，`session.title` 是唯一允许写入主库的字段；项目别名、项目/会话置顶、标签、备注、排序都写应用 sidecar；不提供删除；无实时监听、轮询 / SSE；端口 4570、localhost 绑定。此前「焦点时超过 30 秒自动静默刷新」与「仅手动刷新 + 切换会话刷新」不一致，本文明确将其**移除**，避免隐性后台刷新；时间标签的本地更新不触发数据请求。

## 3. 信息架构与路由

**顶层导航**（固定于左侧）：

- **项目**（默认 `/projects`）：项目列表，不预加载全部会话卡片；置顶在前，其余按最近活动排列；支持按名称 / 完整路径过滤项目。
- **全部记录**（`/all`）：所有项目、目录和会话的索引 + 高级搜索；默认先显示项目索引与最近少量会话，**不一次性挂载全部详情或全部卡片**。
- **已置顶**（`/pinned`）：置顶项目与置顶会话，项目归属可见；作为快捷入口，不引入第二套所有权。

**上下文层级**：`项目 (opencode project_id) → 目录变体 (session.directory，按需分组) → 会话 (session.id) → 用户提问锚点 / 消息`。未知 `project_id` 进入「未归属」虚拟分组；不修改原始归属。默认项目中全部会话按最近活动展示，跨目录时显示目录短标；用户可切换「按工作目录分组」。`project.worktree` 仅作来源提示，不替代会话实际 `session.directory`。同名项目在导航中补充路径 / ID 后缀作区分。

路由建议（均为应用内本地路由，刷新可还原）：

| URL | 页面 | 范围与选中态 |
|---|---|---|
| `/projects` | 项目总览 | 未选择会话，推荐打开最近项目 |
| `/projects/:projectId` | 项目页 | 列表 + 项目概览，可选第一条会话但不自动打开大转录 |
| `/projects/:projectId/sessions/:sessionId` | 项目会话 | 项目上下文、选中行和转录 |
| `/all?q=…&scope=…&sort=…` | 全局索引 / 检索 | 过滤可分享；结果显示项目路径 |
| `/all/sessions/:sessionId?message=:messageId` | 跨项目命中详情 | 保留全局结果上下文，定位原文 |
| `/pinned` | 收藏聚合 | 链接回项目会话或全局上下文 |

`projectId` 与 `sessionId` 均 URL 编码，服务端验证；未知或已消失的项目 / 会话展示「记录不在本机」及返回索引按钮，不自动落到另一条会话。返回浏览保留搜索词、筛选、滚动位置和选中行；刷新深链接重新加载所需资源。项目无可见会话时显示空态，不读取/展示原始目录下其他文件。路径权限只用于已有 `/api/open` 的受限操作。

### 3.1 桌面布局样稿（结构示意，非品牌截图）

```text
┌───────────────┬──────────────────────────┬───────────────────────────────────────┬───────────────┐
│ opencode      │ 项目 / 别名           ⟳ │ 标题 · 操作…                         │ 提问索引      │
│ 搜索  Ctrl K  │ N 条会话 · 最近活动       │ 来源路径 / 更新时间                  │  01           │
│               │ ── 置顶 ──              │───────────────────────────────────────│  02           │
│ 项目          │ ● 交付审核  3 小时前    │ 用户：问题 / 背景                    │  03 ← 当前    │
│   置顶项目    │ ★ 模块设计  昨天        │ 助手：结构化内容与代码块            │  …   （琴键） │
│   最近项目    │ ── 最近 ──              │  ▸ 4 次工具调用 · 展开               │ 12–14 / 26    │
│ 全部记录      │   问题排查  周二        │                                       │ 悬停预览提问  │
│ 已置顶        │   文档整理  上周        │ ↓ 更多历史消息 / 跳转目标            │  收起         │
│               │ [排序/过滤/目录分组]    │                                       │               │
└───────────────┴──────────────────────────┴───────────────────────────────────────┴───────────────┘
```

导航轨道推荐 216–240px；项目会话栏 280–340px；转录阅读区正文最大宽度 760–840px；右侧 TOC 220–260px。屏宽小于约 1280px 先将 TOC 收为可开合抽屉，小于约 900px 合并导航与会话栏，小于约 640px 使用「项目 → 会话 → 正文」逐屏进入与明确返回。尺寸是设计目标，应在真实内容、缩放 200% 和中英文文本下验证，不能硬设导致横向溢出。

### 3.2 三个核心页面

1. **项目总览**：标题「项目」，一排轻量状态（项目数、会话数、最后刷新时间）；项目行显示可区分的名称、工作目录提示、会话数、最近活动、置顶状态；默认仅项目，支持查找项目及打开最近项目。无数据时引导核查 opencode 数据目录，不诱导创建空项目。
2. **项目页**：顶部项目名 / 别名与来源路径 / 操作（置顶、编辑别名、打开目录）；会话列表用双行紧凑项，标题优先，其下为**首条用户提问预览**（`firstQuestion`，若无则省略），右侧时间、消息数与标签；状态栏支持最近 / 最早 / 标题 / 消息数，置顶分组恒在顶部；选中后同页展示转录。会话列表由**服务端分页**（`/api/archive/projects/:id/sessions`），默认每页 30、底部「加载更多」追加，列表标题显示过滤后的总数。项目跨工作目录时可查看所有路径并按目录过滤。
3. **全部记录**：全局搜索输入、范围切换「全部 / 标题与路径 / 正文」，匹配结果按最近活动或相关度排序（后端支持 `sort=recent|relevance`，界面默认最近）。零查询仅展示项目路径索引与近期会话小样本；查询结果以「项目 › 会话 › 命中字段」呈现，同一会话可有多条正文命中，正文命中可直接跳到稳定消息锚点；当前正文检索为带边界的 SQL 扫描（超出置 `truncated`），完整磁盘索引见 §6。

## 4. 阅读、预览与管理交互

**选择与预览**：点击会话行进入阅读区域，行选中高亮且可用键盘上下切换；无会话选中时显示项目概览 / 引导；列表预览最多两行，敏感正文不在 hover tooltip 大段暴露。切换会话清理上一次加载态、取消未完成请求；首次展示最近一页消息，顶部「加载更早」，阅读区内维持滚动锚点。刷新当前会话重新请求，不能继续使用旧卡片缓存冒充最新内容。

**转录**：按真实消息顺序展示用户 / 助手；用户消息使用低饱和块而非全屏聊天气泡；助手正文提供舒适行宽、段落/列表/行内代码/代码块、复制代码；工具调用与输出在步骤折叠面板中按原始类型展示，长输出默认截屏高并可展开 / 复制（不丢失原始文本）；reasoning 若有则置于可折叠「思考过程」，不得与正式答复混成一段。缺少附件可预览内容时显示「附件记录」而非假装能打开；避免 Markdown 的不可信 HTML 注入。

**会话内查找**：阅读区工具条提供「查找」，打开后在当前会话**全部消息**内检索（`GET /api/archive/sessions/:id/find?q=`，按阅读顺序返回每条命中消息与其片段），显示「第 n / 总数」并支持上一处 / 下一处（Enter / Shift+Enter 亦可）。命中词在正文中高亮（Markdown 渲染时通过 rehype 包裹 `<mark>`，不改动原始文本），当前命中消息加重点样式。跳到尚未加载的命中时用定点窗口（`around`）加载再定位；查找开启期间临时取消「仅问答」过滤，避免命中消息被隐藏。Esc 关闭查找。

**提问索引（琴键，最终形态）**：右侧是一条紧凑「琴键」式提问索引，不是文字列表。数据取主库 `message.data.role='user'`，以 `message.id` 为锚点，预览为第一条有意义的用户文本（最多约 80 字），无纯文本时用「用户提问 #N」；接口为 `GET /api/archive/sessions/:id/toc`。交互规格：

- 每个提问一个编号按钮（01、02…），键高自适应、尽量一屏多显；索引与正文各自独立滚动。
- **hover / 聚焦**弹出预览浮层（序号、时间、提问预览）；**触屏首次点按显示预览、再次点按跳转**，浮层内另提供「跳转到提问 →」。
- 当前阅读位置对应的提问高亮（`aria-current="location"`），滚动时自动将当前键滚入可视区；顶部/底部步进按钮翻页，并有可见范围指示（如 `12–14 / 26`）。
- 点击/激活时若目标尚未加载，先请求包含该锚点的定点窗口（`GET /api/archive/sessions/:id/around?messageId=`）再滚动并短暂高亮，**不** `scrollIntoView` 到不存在的节点。
- 键盘可达、Esc 关闭预览、尊重 `prefers-reduced-motion`；阅读区工具条的「收起/打开提问目录」可折叠该索引。

**项目管理（sidecar）**：项目置顶 / 别名 / 备注和会话置顶 / 标签 / 备注；默认不改变 opencode `project` 记录和目录层级，不允许通过网页任意把 session 移入另一项目。「按目录分组」是视图设置，不是迁移数据。项目别名仅改变本应用展示，保留原始项目名与路径的查看入口。会话**改名**若启用，清楚说明写入 opencode `session.title` 并保留原始 `time_updated`；用户可取消编辑。星标迁移从 `ocde.starred` 只做一次、映射 `opencode:ses_…`，冲突时保留服务端已存在置顶值；迁移有完成标记及可重试失败提示，不用裸 localStorage 长期充当事实来源。明确不做删除、归档和跨项目迁移（不同于参考产品）。

**操作和反馈**：标题行省略号菜单集中「置顶、标签、备注、改名、复制恢复命令、复制 session ID」；不可用的目录打开动作需真实错误反馈，目前 `openPath()` 返回 `ok` 仅代表发起打开命令，未来更改文案为「已尝试打开」或改造结果回报，不能承诺已打开。刷新有时间戳与加载态；后台索引尚未完成显示进度或「内容搜索暂不可用」，不能无提示给出遗漏结果。

**检索契约**：项目筛选严格匹配 `project_id`，目录筛选匹配完整 `session.directory`；普通查询按输入词全包含，标题/别名/路径/标签/备注/用户提问/助手正文各字段可过滤，搜索 API 返回 `scope、projectId、sessionId、messageId、snippet、matchField、score、updatedAt` 与分页信息。相关度排序优先精确标题、项目名，其次提问，再次正文；同分再按最近活动及 ID 稳定排序。结果页显示总数或明确「仅当前页 / 估计数」，高亮需保留原文大小写并限制片段长度。查询变更取消旧请求、显示加载 / 失败 / 空结果 / 截断状态，不能把旧搜索结果当新结果。当前已实现可定位的**消息级内容检索**；在升级到磁盘索引前，超宽查询明确标记为 `truncated`（结果已截断），不得暗示覆盖全部历史。

## 5. 视觉系统与无障碍规格

方向：**明亮、克制的档案工作台 / 长文本阅读器**。借鉴 Codex/ChatGPT 的内容优先和低干扰层级，**不复制官方配色/图标/商标**。以白色为主，少量近白灰区分表面，用黑色与深灰承载正文，仅以低饱和石板蓝标记选中、焦点和链接；若后续增加深色主题，仍须独立验证对比与阅读舒适度。

| 元素 | 建议规格 | 用途 |
|---|---|---|
| 背景层级 | canvas / navigation / surface / raised 四层，细边界为主 | 区分四个可滚动区域，不堆重阴影 |
| 字体 | 中文优先系统本地字体栈、英文 UI 使用本地系统字体，代码用本地等宽字体；不请求远程字体 | 兼容中英文与离线，数字时间用等宽数字 |
| 字号 / 行距 | 正文 15–16px、行高 1.6–1.75，列表 13–14px，辅助 12–13px；标题层级 20 / 16 / 14px | 保证转录可长时间阅读；响应浏览器放大 |
| 强调色 | 温和暖色（沿用当前 `--accent` 橘棕基调），信息 / 成功 / 错误语义色独立 | 强调选中、焦点、命中；不用颜色单独传意 |
| 密度 | 会话行 56–72px 高，导航点击目标至少 36px，触摸目标 44px 目标值 | 兼顾扫描与点击，标签过多时折叠 |
| 状态 | 选中：底色 + 左侧细条 + 文本权重；hover：轻底色；focus：清楚的 2px 焦点环 | hover 不应是唯一操作提示 |

长路径单行省略但完整值可复制；中文/英文标题可换行但限制列表高度；超长代码有区域内横向滚动；搜索结果的片段高亮可见且使用语义 `<mark>`。icon 可选 `lucide-react`（仅 npm，图标附文字/aria-label），简单组件首选语义 HTML + CSS，**不为纯文档阶段安装依赖**。菜单 / 弹层如自研无法满足焦点管理和键盘交互，再考虑 npm 的 Radix Primitives；全文虚拟化仅在长会话测试证明必要时选 npm 虚拟化库（需与消息锚点定位兼容）。不引入通用组件库或远程 CDN。尊重 `prefers-reduced-motion`；Tab 可达、Esc 关闭弹层 / 清除输入而不是丢失阅读位置、屏幕阅读器报送结果数与错误；目标是 WCAG 2.2 AA 的键盘和文本对比。键盘快捷键：`/` 聚焦**全局**搜索，`Ctrl/Cmd+K` 打开统一搜索入口，`Esc` 逐层退出当前浮层；仅在非输入控件时生效，避免浏览器 / 系统快捷键冲突。

## 6. 数据模型、接口和性能规划

先用读取 `project` 表的 `project.id` 作为稳定项目 ID，`session.project_id` 归属；仅在某些 opencode 版本无 `project` 表 / `project_id` 时回退到**完整规范化 directory** 派生的 `dir:<hash>`，并在数据上标记 `identitySource=directory`；不同来源的项目 ID 有前缀，避免碰撞。路径仅做规范化用于等价判断，**不依赖真实文件存在，不解析符号链接、不自动合并**。原始 `session.directory` 保留供过滤和恢复命令使用。会话仍仅显示顶层非空记录；子会话的消息是否计入父会话正文需要调研实际数据后单独决策，不得静默混入。

Sidecar 建议 `data/meta.json`（已在早期规划提出）：版本字段 + `projects`（项目 ID -> pinned / alias / note / order）和 `sessions`（session ID -> pinned / pinOrder / tags / note / order）。同时建立 `data/` 忽略规则；不删除已经消失的记录，保留以防短暂主库不可用 / 工作目录切换，清理由明确维护动作完成。每次字段级更新做校验与原子写入，串行化并发请求以免覆盖；写失败返回错误并恢复乐观 UI。归属主库变化时 sidecar 以稳定 ID 挂靠，显示按新归属；目录回退 ID 变更时提示别名可能未匹配，不静默合并。

当前实现 API（命名空间 `/api/archive/*`；读连接只读，改名写连接独立）：

| 方法 | 路径 | 返回重点 |
|---|---|---|
| GET | `/api/archive/index` | `{projects:[{id,identitySource,name,alias,worktree,paths,sessionCount,lastActivity,pinned}], sessions:[…]}`，从数据库一次聚合；项目身份默认 `project:<project_id>`，无 project 表时回退 `dir:<sha1(规范化目录)>` 并置 `identitySource=directory`。每个会话含首问摘要 `firstQuestion` |
| GET | `/api/archive/projects/:id/sessions?cursor=&limit=&sort=&directory=&q=` | 项目内会话的**服务端分页**列表（置顶优先，`sort=recent\|oldest\|title\|messages`），支持工作路径与文本过滤；返回 `{sessions,total,hasMore,nextCursor}` |
| GET | `/api/archive/sessions/:id?cursor=&limit=` | 详情元数据与一页消息（复合 `(time_created,id)` 游标），含 `id,role,createdAt,parts[]` 与 `hasMore / nextCursor`；前端按正序渲染 |
| GET | `/api/archive/sessions/:id/toc` | 按时间正序的 `{seq,messageId,createdAt,preview}`；不预先拉全量正文 |
| GET | `/api/archive/sessions/:id/around?messageId=&limit=` | 命中消息**前后定点窗口**（一条 SQL 取回原消息前后各若干条，不再逐页逼近）；TOC 与全局搜索深链通用 |
| GET | `/api/archive/sessions/:id/find?q=&limit=` | **会话内查找**：按阅读顺序返回每条含关键词的消息 `{seq,messageId,snippet}`（每消息一处），供上/下一处定位 |
| GET | `/api/archive/search?q=&scope=&sort=&cursor=&limit=&project=` | **消息级多命中**（每会话可多条、带 `messageId` 锚点可定位原文）；`scope=all\|metadata\|content`、`sort=recent\|relevance`、游标分页，返回 `scope,sessionId,projectId,messageId,snippet,matchField,score,updatedAt` 与 `total/hasMore/truncated` |
| GET/PUT | `/api/archive/meta/projects/:id`、`/api/archive/meta/sessions/:id` | sidecar 字段级更新，限制长度与类型 |
| PATCH | `/api/archive/sessions/:id/title` | 唯一主库写入：`session.title`，明确成功 / 冲突 / 忙碌 |
| GET | `/api/open?path=` | 非承诺式反馈；未来写入型打开可评估改 POST |

旧 `/api/conversations`、`/api/conversation`、`/api/search` 连同 `server/search.js`、`server/sources/*` 已移除，唯一的检索语义是 `/api/archive/search`，不再有两个同名搜索语义并存。`/api/archive/index` 从数据库一次聚合统计，而不是逐条读取全部会话详情。详情分页采用 `(time_created,id)` 复合游标，避免相同时间戳漏/重；`part` 在该页消息 ID 上批量查询，避免 N+1；保留类型而非 emoji 标记拼接。TOC 按稳定消息 ID 返回；缺少旧 schema 字段应有能力检测 / 降级，而不是通用 catch 后悄悄报「没有数据」。数据库只读访问与改名写连接必须隔离；对外 API 遵循 localhost 限制、限制输入长度、分页大小与 path 验证。

**全量搜索实现选择**：当前 `/api/archive/search` 采用带边界的 SQL 文本扫描（`instr(lower(json_extract(...)))`，`SEARCH_CAP=1000`，超出时置 `truncated` 提示），不再使用旧的逐会话内存缓存。若规模继续增长，优先独立可重建的本地搜索索引 `data/search.db`（SQLite FTS5 或等效）作为应用 sidecar；只读取主库 `message/part`，索引不反写主库。首次构建按批次、后台进度可见；记录 `messageId/sessionId/projectId/role/snippet` 与规范化正文，增量依据消息 ID / 主库更新时间或可靠的变更标记，对更新、删除、改名与目录变化正确重建。确认 opencode FTS5/中文分词能力：基础 unicode tokenizer 的中文子串检索可能不满足需求，中文要做真实用例验证，必要时分词 / n-gram 辅助索引并标明匹配语义。索引异常可删除重建而不影响原始数据库；期间元数据搜索可用、正文搜索明确标记不完整。旧的 `server/search.js` 片段缓存（前 30 条 / 4000 字符）已删除，不得再以片段缓存充当全量覆盖。所有索引、meta、缓存路径须 `.gitignore` 且不得打包。

## 7. 前端模块边界与文件落点（实施时）

> 现状提示：前端仍是单文件 `src/App.jsx`（`Navigation` / `ProjectsPage` / `ProjectPage` / `AllRecordsPage` / `SessionList` / `Transcript` / `QuestionKeys` / `SearchDialog` / `MetadataEditor` 等组件均内联其中），**尚未按本节拆分**——属待办的内部重构，不影响功能。

- `src/App.jsx`：最终收敛为应用壳、视图路由和全局错误状态，移走卡片实现；`src/index.css` 改为 tokens + 基础排版，各区域独立样式；删去迁移后无用的 `src/sort.css` 规则。
- `src/components/Navigation.*`：项目/全部/置顶、项目快捷列表、折叠状态。
- `src/pages/ProjectsPage.*`、`ProjectPage.*`、`AllRecordsPage.*`：页面级加载与路由数据；`ProjectPage` 自带会话列表与阅读区。
- `src/components/SessionList.*`、`Transcript.*`、`QuestionKeys.*`（提问索引「琴键」，最终形态见 §4）、`SearchDialog.*`、`MetadataEditor.*`：与 API 形状一一对应，复杂交互独立；组件命名可沿用现有 JSX/CSS 项目风格，不强制 TypeScript。
- `src/api/…`：集中 URL 构造、请求取消与错误解析；浏览状态存 URL，纯偏好（导航宽度、折叠状态）可保留 localStorage；不要把星标当客户端唯一事实源。
- `src/rehypeFindHighlight.js`：会话内查找的 Markdown 高亮，作为 unified **attacher**（以 `[rehypeFindHighlight, term]` 传入 `rehypePlugins`），把命中词包成 `<mark class="find-hit">` 而不改动原始文本。
- `server/archive.js`：集中 opencode 数据访问（项目聚合与身份回退 / 服务端分页会话列表 / 游标详情 / TOC / 定点窗口 / 会话内查找 / 检索）与 `resumeCommand`；`server/meta.js` 与 `server/rename.js` 集中写入；`vite.config.js` 注册最小 API 路由（必要时拆出 `server/router.js`）；`scripts/smoke-test.mjs`、`scripts/archive-test.mjs`、`scripts/find-highlight-test.mjs` 补契约与回归验证。旧的 `server/sources/*`、`server/search.js` 已删除。
- `docs/IMPLEMENTATION.md` 保留旧设计；此文档是新阶段的验收基准。

## 8. 分阶段交付与可验证验收

| 阶段 | 目标与依赖 | 完成标准 |
|---|---|---|
| D0 数据契约核查 | 盘点实际 opencode schema、父/子会话、`project_id`/目录分布；固定例子数据 | 写清无项目/同名目录/跨目录项目处理；旧 `/api/*` 冒烟测试仍过 |
| D1 项目索引 + 路由骨架 | 只读 `/api/projects`、项目内分页摘要；项目总览、导航、项目列表、深链 | 首页不平铺全部会话；同名目录不错误合并；返回/刷新保留项目上下文；389 条样本浏览流畅 |
| D2 阅读器 + TOC | 结构化分页详情、问答目录、消息窗口定位、移动端逐屏导航 | 超过 30 条的会话能加载到第一条；每条用户提问可定位；工具 / reasoning 与正文正确区分；键盘可操作 |
| D3 Sidecar 管理 | 项目 / 会话置顶、项目别名、标签/备注、星标迁移；改名主库独立交付 | 刷新后状态一致；异常 / 并发写不会丢元数据；只进行 title 改名时主库只有指定 `session.title` 变化；不支持删除 |
| D4 全部记录 / 深度检索 | 项目+路径索引、跨项目筛选、全量搜索索引与命中深链 | 任意历史正文（含第 31 条之前及 4000 字符之后）可搜到并精准定位；空 / 构建中 / 失败反馈明确；中英文检索实测 |
| D5 视觉与回归 | 完整状态、响应式、性能、文档与旧 API 收敛 | 360/768/1280/1600px、200% 缩放可读；键盘与屏幕阅读器基本路径可达；`npm test` 与 `npm run build` 通过；仅 localhost |

各阶段必须覆盖：数据库缺失 / 空库、同名目录 / 相同时间戳、超长标题/路径、非中文或非英文文本、正在写入 WAL、无用户文本、目录缺失、搜索与切换竞态、网络失败重试。性能预算建议开发时在 390 会话本机样本验证：初次项目列表 < 1s、切会话首屏 < 1s（暖机），长会话列表滚动不卡；这些是**目标不是现测数据**。不扩大到完全复刻 ChatGPT 桌面应用，也不接入云端登录或同步。

## 9. 参考样本与证据边界

- [OpenAI / ChatGPT Learn：Projects and chats](https://learn.chatgpt.com/docs/projects)（兼容地址：[Codex 项目文档](https://developers.openai.com/codex/projects.md)）：项目/聊天组织、置顶、搜索，以及官方文档中的「多个项目在侧边栏、聊天在主区域」插图说明。**采样来源为官方文档文字及公开示意说明**，不是对已登录桌面客户端像素级截图的测量。
- [OpenAI / ChatGPT Learn：ChatGPT desktop app](https://learn.chatgpt.com/docs/app)（[Markdown](https://developers.openai.com/codex/app.md)）：跨项目并行工作、从项目或文件夹进入工作。
- [OpenAI Developers：Codex 概览](https://developers.openai.com/codex/)：公开界面示例显示 Pinned / Projects / Recents 的左导航，可用于信息架构对照。官方产品会持续变动，本文仅抽象设计原则，不声称完全复制当前客户端。
- 本项目源码：`src/App.jsx`、`src/index.css`、`src/theme.css`、`src/rehypeFindHighlight.js`、`server/archive.js`、`server/meta.js`、`server/rename.js`、`server/open.js`、`vite.config.js`、`scripts/smoke-test.mjs`、`scripts/archive-test.mjs`、`scripts/find-highlight-test.mjs`；本机 `opencode.db` schema / 匿名统计只读核验（未采集或写入任何私有对话内容到文档）。

> 本轮没有采集/保存官方产品图片文件，也没有做视觉识别的像素测量；文中的文本框图为**原创结构示意**。若后续需要视觉稿，在可合法获取的官方公开样本基础上单独制作，并通过真实浏览器的桌面/移动端截图验证实现，而不是把示意当成现有产品截图。

## 10. 实施进度与差距（2026-10-09）

**已落地**：项目首页与侧栏、项目内会话列表及目录筛选、响应式阅读器、分页加载、**提问索引（紧凑「琴键」+ hover/聚焦预览 + 触屏二次点按跳转）**、跨项目检索、项目/会话置顶及别名/备注/标签 sidecar、独立改名接口（唯一写 `session.title`）、只读 Markdown 渲染。本阶段（P0/P1/P2）另已完成：

- **旧 API 收敛**：移除 `/api/conversations`、`/api/conversation`、`/api/search`、`/api/sources` 及 `server/search.js`、`server/sources/*`；唯一检索语义为 `/api/archive/search`，`resumeCommand` 归入 `server/archive.js`。
- **消息级多命中检索**：`/api/archive/search` 每条命中带 `messageId` 锚点，支持 `scope=all|metadata|content`、`sort=recent|relevance`、游标分页，返回 `snippet/matchField/score/updatedAt` 与 `total/hasMore/truncated`；界面按命中字段（标题 / 项目 / 路径 / 标签 / 备注 / 会话 ID / 正文）标注，关键词高亮，可跳到命中消息。
- **`around` SQL 定点窗口**：一条 SQL 取回命中消息前后各若干条，替代逐页逼近。
- **目录回退身份**：无 `project` 表 / `project_id` 时以 `dir:<sha1(规范化目录)>` 作为稳定项目 ID 并暴露 `identitySource`，避免同名目录被静默合并。
- **会话内查找**：`/api/archive/sessions/:id/find` 返回每条命中消息，阅读区「查找」工具条支持上/下一处、Markdown 内 `<mark>` 高亮与当前命中强调，跳到未加载命中时用 `around` 定位。高亮插件独立为 `src/rehypeFindHighlight.js`（unified attacher，经 `[[rehypeFindHighlight, term]]` 传入 `rehypePlugins`），并有 `scripts/find-highlight-test.mjs` 回归测试防止接线回退。
- **会话列表首问摘要 + 服务端分页**：会话摘要新增 `firstQuestion`（首条用户提问，供列表预览）；项目页会话列表改用 `/api/archive/projects/:id/sessions` 服务端分页（默认 30/页，「加载更多」追加，服务端执行排序与过滤）。

**尚未达到目标规格（D4/D5 待办）**：

- 检索仍是带边界的 SQL 文本扫描（`SEARCH_CAP=1000`，超出置 `truncated`），**尚不是可重建的磁盘索引 / 后台进度**；未覆盖工具与思考内容；无按标签 / 时间 / 项目的组合筛选。
- 结构化工具输出虚拟化 / 大规模性能验收未做；旧 star `localStorage` 未自动迁入 sidecar（当前应用本身不产生 star 数据）。
- 前端未按 §7 拆分（`src/App.jsx` 仍为单文件）。
- 无障碍 / 真机验收未完成：已通过 Browser Harness 检查桌面项目导航、分页、提问索引、全局检索跳转及移动端 390/768/1280/1600px 布局（曾修复 390px 项目卡片横向溢出）；尚未完成截图内容审阅、触控实机与屏幕阅读器验收。

**视觉迭代**：`src/theme.css` 统一明亮档案样式（白色底面、轻边框、黑灰文字，少量石板蓝仅用于交互重点）；未引入远程字体、图片或 CDN，功能与数据契约未因换肤变更。
