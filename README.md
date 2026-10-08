# opencode Dialog Explorer

A small Vite + React app that lists your local **opencode** conversations
(`~/.local/share/opencode/opencode.db`), lets you search/filter them, preview
their messages, and copy a ready-to-run command to resume any session.

This is a fork of [daniel-farina/ai-session-manager](https://github.com/daniel-farina/ai-session-manager)
(`ai-session-manager`) reduced to a single source — opencode — as the basis for
a richer dialog browser. See `IMPLEMENTATION.md` for the planned enhancements.

## Data source

| Tool | Storage read | Resume command |
|------|--------------|----------------|
| **opencode** | `~/.local/share/opencode/opencode.db` (SQLite) | `opencode --session <id>` |

Only top-level sessions (`parent_id IS NULL`) with at least one message are
listed. If the database is missing, the list is empty.

## Privacy & security

- **Everything stays local.** The app reads the SQLite database opencode already
  wrote to your home directory and serves it to your own browser. No telemetry,
  no network calls, nothing bundled or uploaded.
- The server binds to **localhost only** (enforced in `vite.config.js`). Don't
  run it with `--host` — the API would serve your private conversation history
  to anyone who can reach the port.
- The database is opened **read-only**. Session refs are pattern-checked
  (`ses_…`) so the API can only read a valid session id. `/api/open` validates
  paths and spawns the OS opener via `execFile` with an args array, never a
  shell.

## Platform support

- **macOS** — folder-open uses `open`.
- **Linux** — folder-open uses `xdg-open`.
- **Windows** — folder-open uses `explorer`.

## Run

```bash
npm install
npm run dev      # opens http://localhost:4570
npm test         # smoke-test the adapter + endpoints against your local data
npm run build && npm run preview   # serve the production build (API included)
```

The API runs as a Vite middleware on **both** the dev server and the preview
server, so the built `dist/` works end-to-end via `npm run preview` (it still
reads your local database — nothing is bundled or sent anywhere).

Requires Node 22+ with the built-in `node:sqlite` (`ExperimentalWarning` is
expected on Node 22).

`npm test` (`scripts/smoke-test.mjs`) lists conversations, fetches a detail,
and validates the data contract (unique keys, no missing fields / future
timestamps, valid message roles, newest-first ordering), plus ref-traversal
rejection and the open-path module. Exits non-zero on any failure. On a machine
with no opencode data yet, the data-dependent checks are skipped.

## How it works

- A tiny dev-server API (in `vite.config.js`) delegates to the opencode **source
  adapter** in `server/sources/opencode.js`, which exports `{ source, list,
  detail }` and returns a normalised record via `makeEntry` (`_shared.js`).
- `GET /api/conversations` returns one entry per top-level session (title,
  project, branch, message count, last activity, ready-to-run resume command),
  sorted most-recent first.
- `GET /api/conversation?source=…&ref=…` returns the last 30 messages for one
  session.
- `GET /api/search?q=…` full-content search over cached transcripts.
- `GET /api/open?path=…` opens a project folder in the OS file manager.
- `GET /api/sources` returns display metadata (label + accent colour).

## Features

- **Search** across title, project, path, session id, and first message (plus
  full-content search).
- **Filter** by project (dropdown) and starred-only.
- **Sort** by most recent / oldest / most messages / title.
- **Filters persist** across refresh (`ocde.filters` in `localStorage`).
- **Expand** any card to read the last 30 messages, color-coded, with tool calls
  and results inlined.
- **Copy resume command** — the exact `cd "<cwd>" && opencode --session <id>`.
- **Open** — opens the conversation's project folder in the OS file manager.
- **Star** — pin the conversations you care about (stored in `localStorage`).
- **PWA** — installable (`public/manifest.webmanifest`, `public/sw.js`, icons;
  registered via `src/pwa.js`). The service worker is network-first so it never
  serves stale content and doesn't interfere with dev/HMR; `/api/*` is always
  network.

## License

[MIT](LICENSE)
