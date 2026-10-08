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
  a project, including by working directory when a project has several.
- **Read the full history.** Load older messages in pages. Markdown is rendered
  for reading; tool calls and reasoning remain available in collapsible sections.
  Enable **Q&A only** to hide tool calls and reasoning while reading.
- **Jump between questions.** A compact, scrollable question rail previews each
  user question, follows your reading position, and loads earlier history when
  you jump to a question that is not on the current page.
- **Search across projects.** Find sessions by title, project name, path, tags,
  notes, or historical text. A text match can take you directly to its message.
  Press `Ctrl+K` / `⌘K` or `/` to focus search.
- **Organize your archive.** Pin projects and sessions; add project aliases and
  notes, or session tags and notes. Rename a session when you want its title to
  change in opencode itself.
- **Return to your work.** Copy the resume command or session ID, or try to open
  the project folder in your OS file manager. The layout adapts to narrow screens
  and can be installed as a PWA.

## Get started

Requires **Node.js 22+** (for the built-in `node:sqlite`) and an existing
opencode database at `~/.local/share/opencode/opencode.db`.

```bash
npm install
npm run dev
```

Open `http://localhost:4570`. If the database does not exist or has no nonempty
top-level sessions, the archive is empty. Only sessions with `parent_id IS NULL`
and at least one message appear in the index. An `ExperimentalWarning` from
`node:sqlite` on Node 22 is expected.

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
| Conversations, projects, and message content | `~/.local/share/opencode/opencode.db` | Read-only except session renaming |
| Pins, aliases, tags, and notes | `data/meta.json` | Local sidecar; Git-ignored |
| Session title | opencode's `session.title` | Updated only when you rename a session; `time_updated` is preserved |

The app has no telemetry or external CDN; the UI requests data from its local
server. Session IDs and folder paths are validated before use. Folder opening
uses the OS opener without a shell (`open` on macOS, `xdg-open` on Linux,
`explorer` on Windows, and `explorer.exe` with a WSL path on WSL). An “open
folder” response means the command was attempted, not that the file manager
necessarily displayed the folder.

To resume a session, use the copied command in your terminal:

```bash
cd "<session working directory>" && opencode --session <session-id>
```

## How it works

- `server/archive.js` reads the project/session index, pages through messages,
  builds the user-question directory, and searches historical text. Broad
  content searches may take longer. Search results show at most one match per
  session and up to 100 sessions in the UI.
- `server/meta.js` writes app-only metadata to `data/meta.json`; `server/rename.js`
  handles the optional write to opencode's session title.
- `vite.config.js` exposes these local APIs in both dev and preview mode; the
  legacy conversation/search endpoints remain available for compatibility.
- The installable PWA uses a network-first service worker; API requests always
  go to the local server rather than an offline cache.

For background and design decisions, see the [UI redesign notes](./docs/UI-REDESIGN.md)
and [earlier implementation plan](./docs/IMPLEMENTATION.md).

## License

[MIT](LICENSE)
