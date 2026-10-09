# opencode Dialog Explorer

English | [中文](./README.zh-CN.md)

A local, project-first archive for **opencode** conversations. Find the project
you worked on, revisit a session, jump to an earlier question, or search across
your entire history. When you want to continue working, copy the resume command
and run it in opencode. This is a reader, not a chat client.

Built with Vite + React. Forked from
[daniel-farina/ai-session-manager](https://github.com/daniel-farina/ai-session-manager)
and focused on a single source: the local opencode SQLite database.

## What you can do

- **Browse by project.** Projects are grouped by opencode `project_id`, not just
  folder name. Filter projects by name or path; filter and sort sessions within
  a project, including by working directory when a project has several. Each row
  previews the session's first question, and long lists load in pages.
- **Read the full history.** Load older messages in pages. Markdown is rendered
  for reading; tool calls and reasoning remain available in collapsible sections.
  Enable **Q&A only** to hide tool calls, reasoning, and intermediate replies,
  keeping the last text answer for each question. The setting is remembered in
  this browser across projects, sessions, and reloads.
- **Jump between questions.** A compact, scrollable question rail previews each
  user question, follows your reading position, and loads earlier history when
  you jump to a question that is not on the current page.
- **Find within a session.** Open **Find** in the reader to search every message
  in the open session, highlight matches in the text, and step through hits with
  previous / next (Enter / Shift+Enter). Jumping to a hit that is not loaded
  brings it in and scrolls to it.
- **Search across projects.** Find sessions by title, project name, path, tags,
  notes, or historical text, and switch the scope between everything,
  titles & paths, and message text. Every text hit keeps its message anchor, so a
  session can contribute several hits and each jumps straight to its message.
  Press `Ctrl+K` / `⌘K` or `/` to focus search.
- **Organize your archive.** Pin projects and sessions; add project aliases and
  notes, or session tags and notes. Drag pinned projects (on **Pinned**) or
  pinned sessions (inside a project), or use ↑ / ↓ for precise keyboard-friendly
  moves. Rows animate immediately and persist their order to the local sidecar;
  they never change opencode data. Rename a session when you want
  its title to change in opencode itself.
- **Return to your work.** Copy the resume command or session ID, or try to open
  the project folder in your OS file manager. The layout adapts to narrow screens
  and can be installed as a PWA.

## Get started

Requires **Node.js 22+** (for the built-in `node:sqlite`) and an existing
OpenCode SQLite database. The server resolves its location using OpenCode's
data-directory convention:

| Platform | Default database path |
|----------|-----------------------|
| Linux / macOS | `~/.local/share/opencode/opencode.db` |
| Windows | `%USERPROFILE%\.local\share\opencode\opencode.db` |

If `XDG_DATA_HOME` is set to an absolute path, the database is read from
`$XDG_DATA_HOME/opencode/opencode.db` instead. The server reads the database
belonging to the OS/environment where **Node runs**: running this app in WSL
does not automatically read a separate Windows OpenCode installation.

```bash
npm install
npm run dev
```

Open `http://localhost:4570`. If the database does not exist or has no nonempty
top-level sessions, the archive is empty. Only sessions with `parent_id IS NULL`
and at least one message appear in the index. An `ExperimentalWarning` from
`node:sqlite` on Node 22 is expected.

### Background service (built preview)

Run `npm install` once on the OS where you intend to run the server (Node.js 22+). On Windows, double-click `service/start.cmd` and `service/stop.cmd`; their windows stay open to show the result. On macOS, Linux, or WSL, run `sh service/start.sh` and `sh service/stop.sh` in a terminal. The same commands work everywhere through npm:

```text
npm run service:start
npm run service:status
npm run service:restart   # rebuild and reload the running service
npm run service:stop
```

Start builds the app and launches the preview in the background at `http://127.0.0.1:4570`. Local state and logs are in the Git-ignored `data/service.json` and `data/service.log`. Double-clicking Windows `start.cmd` rebuilds and replaces a running instance managed by this script, then opens the homepage once in the Windows default browser; it will not replace another process occupying port 4570. Repeated `service:start` calls **reuse** the running service without reloading code or config, so after changing the app run `npm run service:restart` (or stop then start). Stop only terminates a verified instance started by this entry point, not `agent:dev` or an unrelated process on port 4570. WSL uses the Linux launcher and reads the WSL OpenCode database; use the Windows launcher for native Windows data. Do not share one `node_modules` between Windows and WSL: packages such as Rollup install platform-specific binaries, so use a separate project copy and install dependencies in each OS.

```bash
npm test                       # smoke and archive checks
npm run build
npm run preview               # serve the built app with its local API
```

The API is Vite middleware in both development and preview mode. The built
frontend does not contain your conversations; preview still reads the database
on the machine running the server. Keep the server on localhost: it serves
private transcripts and is not intended for network access.

## Where data goes

| Data | Location | Behavior |
|------|----------|----------|
| Conversations, projects, and message content | OpenCode data directory (see platform paths above) | Read-only except session renaming |
| Pins, ordering, aliases, tags, and notes | `data/meta.json` | Local sidecar; Git-ignored |
| Session title | opencode's `session.title` | Updated only when you rename a session; `time_updated` is preserved |

The app has no telemetry or external CDN; the UI requests data from its local
server. Session IDs and folder paths are validated before use. Folder opening
uses the OS opener without a shell (`open` on macOS, `xdg-open` on Linux,
`explorer` on Windows, and a PowerShell helper on WSL that opens Explorer with
a converted path and attempts to focus its window). Windows may still deny
foreground activation. An “open
folder” response means the command was attempted, not that the file manager
necessarily displayed the folder.

To resume a session, run the copied command in the same environment where the session lives. On Windows the generated command targets PowerShell (not CMD); macOS, Linux, and WSL use a POSIX shell:

```sh
opencode '<session working directory>' --session <session-id>
```

Passing the project directory directly avoids Windows drive-switching issues with `cd`. The original directory must still exist; native Windows paths cannot be used directly in WSL (or vice versa).

## How it works

- `server/archive.js` reads the project/session index, pages through messages,
  serves the server-paginated project session list (`firstQuestion` preview
  included), builds the question index, finds within a session, and searches
  historical text. Content search is a bounded SQL scan that returns each hit
  with its message anchor (several hits per session are possible); very broad
  queries flag the results as truncated.
- `server/meta.js` writes app-only metadata to `data/meta.json`; `server/rename.js`
  handles the optional write to opencode's session title.
- `vite.config.js` exposes the local `/api/archive/*` APIs in both dev and preview
  mode; `/api/archive/search` is the only search endpoint.
- The installable PWA caches static assets with a network-first service worker;
  navigations and API requests require the local server, so a stopped service
  cannot replay old conversations from offline cache. Refresh an existing tab
  to check whether the server is still available.

For background and design decisions, see the [UI redesign notes](./docs/UI-REDESIGN.md)
and [earlier implementation plan](./docs/IMPLEMENTATION.md).

## License

[MIT](LICENSE)
