# 项目自带 Skill

这个目录是仓库**预置的 Agent 技能包（skill）**，随项目一起提供，供 AI 编码 Agent（如 opencode）直接加载使用。它是一份“拿来即用”的说明书，帮你（和你的 Agent）在几分钟内搞清楚：这个项目是什么、怎么部署运行、以及如何通过 CLI / HTTP 读取 opencode 的会话数据。

## 里面有什么

- `opencode-dialog-explorer/SKILL.md`：主技能说明。涵盖部署与后台服务、`npm link`、**4 条访问 opencode 会话内容的途径**、`ocde` CLI 速查、常见 Agent 工作流、坑与边界。
- `opencode-dialog-explorer/references/agent-api.md`：`/api/agent/*` 机器接口的完整契约副本（与 `docs/AGENT-API.md` 同步）。

## 能解决什么

- **免去“先读源码才知道怎么跑”的麻烦**：部署、启停、重建、端口占用、Windows / macOS / Linux / WSL 的差异，都已在 skill 里写清。
- **让 Agent 快速上手取数能力**：跨会话全文检索、按大致会话名找回历史、会话内查找、查看某条消息、复制恢复命令（resume）。
- **边界明确**：只读、仅本机、不写入 opencode 数据；不会误改你的会话。

## 怎么用

- **全局安装（推荐）**：把 `opencode-dialog-explorer/` 整个目录放到 opencode 的全局 skills 目录即可被自动发现：
  - macOS / Linux / WSL：`~/.config/opencode/skills/`
  - Windows：`%USERPROFILE%\.config\opencode\skills\`
- **按需引用**：也可以直接把本目录指给 Agent，让它读取 `opencode-dialog-explorer/SKILL.md`。
- **搭配使用**：skill 会引导 Agent 使用项目自身的 `ocde` CLI 与本地服务的 `/api/agent/*` 接口；两者与人工界面共享同一套只读数据层，可放心并用。

详细内容与最新契约以 `opencode-dialog-explorer/SKILL.md` 及 `opencode-dialog-explorer/references/agent-api.md` 为准。
