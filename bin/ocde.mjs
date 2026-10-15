#!/usr/bin/env node
// ocde — machine-friendly CLI over the local opencode archive. Read-only.
//
//   ocde path | projects | recent | search | show | toc | find | resume
//
// Defaults to importing the archive core directly (no server needed). Pass
// --http to route through a running dialog-explorer service instead.
import {
  agentHealth, agentProjects, agentRecent, agentSearch, agentShow, agentToc, agentFind, agentResume,
} from '../server/agent.js';

const BOOLEAN = new Set(['json', 'full', 'with-question', 'http', 'help']);
const SERVICE = () => String(process.env.OCDE_SERVICE_URL || 'http://127.0.0.1:4570').replace(/\/+$/, '');

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h') { flags.help = true; continue; }
    if (arg.startsWith('--')) {
      const [rawName, inline] = arg.slice(2).split(/=(.*)/s);
      const name = rawName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (BOOLEAN.has(rawName)) { flags[name] = true; continue; }
      if (inline !== undefined) { flags[name] = inline; continue; }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[name] = next; i++; }
      else flags[name] = true;
    } else rest.push(arg);
  }
  return { flags, rest };
}

async function get(path, params) {
  const url = new URL(SERVICE() + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const httpApi = {
  health: () => get('/api/agent/health'),
  projects: ({ limit }) => get('/api/agent/projects', { limit }),
  recent: ({ project, dir, limit, withQuestion }) => get('/api/agent/recent', { project, dir, limit, withQuestion, with_question: withQuestion }),
  search: ({ q, scope, project, limit, sort }) => get('/api/agent/search', { q, scope, project, limit, sort }),
  show: ({ id, limit, maxChars, cursor, full }) => get(`/api/agent/sessions/${encodeURIComponent(id)}`, { limit, maxChars, cursor, full }),
  toc: ({ id }) => get(`/api/agent/sessions/${encodeURIComponent(id)}/toc`),
  find: ({ id, q }) => get(`/api/agent/sessions/${encodeURIComponent(id)}/find`, { q }),
  resume: async ({ id }) => {
    const meta = await get(`/api/agent/sessions/${encodeURIComponent(id)}/meta`);
    const s = meta.session || {};
    return { id: s.id, directory: s.directory, command: s.resume };
  },
};

const directApi = {
  health: async () => agentHealth(),
  projects: async ({ limit }) => agentProjects({ limit }),
  recent: async ({ project, dir, limit, withQuestion }) => agentRecent({ project, dir, limit, withQuestion }),
  search: async ({ q, scope, project, limit, sort }) => agentSearch({ q, scope, project, limit, sort }),
  show: async ({ id, limit, maxChars, cursor, full }) => agentShow({ id, limit, maxChars, cursor, full }),
  toc: async ({ id }) => agentToc(id),
  find: async ({ id, q }) => agentFind(id, q),
  resume: async ({ id }) => agentResume(id),
};

const USAGE = `ocde — local opencode archive for agents (read-only)

Usage: ocde <command> [options]

Commands:
  path                     show service url + database path
  projects [--limit N]     list projects
  recent [--project P] [--dir D] [--limit N] [--with-question]
  search "<q>" [--scope all|metadata|content] [--project P] [--limit N] [--sort recent|relevance]
  show <id> [--limit N] [--max-chars N] [--cursor C] [--full]
  toc <id>                 list user questions
  find <id> "<q>"          search inside one session
  resume <id>              print the resume command

Options:
  --json        force JSON output (default when piped)
  --http        route through the running service (default: read the db directly)
  -h, --help    show this help`;

function human(cmd, r) {
  switch (cmd) {
    case 'health':
    case 'path':
      return `service: ${r.serviceUrl}\ndb:      ${r.dbPath} ${r.dbExists ? '' : '(missing)'}`;
    case 'projects':
      return r.projects.map((p) => `${p.pinned ? '★ ' : '  '}${p.name}  ·  ${p.sessionCount} sessions  ·  ${p.lastActivity || '-'}\n    ${p.id}\n    ${p.deepLink}`).join('\n');
    case 'recent':
      return r.sessions.map((s) => `${s.updatedAt || '-'}  ${s.pinned ? '★ ' : ''}${s.title}\n    ${s.id}  ·  ${s.messageCount} msgs${s.firstQuestion ? `  ·  ${s.firstQuestion}` : ''}\n    ${s.resume}`).join('\n');
    case 'search':
      return `${r.total} match(es)${r.truncated ? ' (truncated)' : ''}\n` + r.hits.map((h) => `[${h.matchField}] ${h.title}\n    ${h.snippet}\n    ${h.deepLink}`).join('\n');
    case 'show':
      return `${r.session.title}  (${r.session.id})\n${r.session.directory}\n${r.session.resume}\n\n` +
        r.messages.map((m) => `## ${m.role} · ${m.at}\n${m.text}${m.tools ? `\n[tools: ${m.tools.join(', ')}]` : ''}`).join('\n\n') +
        (r.hasMore ? `\n\n…older messages available (cursor: ${r.nextCursor})` : '');
    case 'toc':
      return r.items.map((t) => `${String(t.seq).padStart(2, '0')}  ${t.preview}\n    ${t.deepLink}`).join('\n');
    case 'find':
      return r.hits.map((h) => `${String(h.seq).padStart(2, '0')}  ${h.snippet}\n    ${h.deepLink}`).join('\n');
    case 'resume':
      return `${r.directory}\n${r.command}`;
    default:
      return JSON.stringify(r, null, 2);
  }
}

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const cmd = rest[0];
  if (flags.help || !cmd) { console.log(USAGE); process.exit(cmd ? 0 : 0); }
  if (cmd === 'path') {
    const result = await (flags.http ? httpApi : directApi).health();
    return output('health', result, flags);
  }
  const api = flags.http ? httpApi : directApi;
  const args = {
    id: rest[1], q: cmd === 'find' ? rest[2] : rest[1], project: flags.project, dir: flags.dir,
    limit: flags.limit, maxChars: flags.maxChars, cursor: flags.cursor,
    scope: flags.scope, sort: flags.sort, full: !!flags.full, withQuestion: !!flags.withQuestion,
  };
  const run = { projects: 'projects', recent: 'recent', search: 'search', show: 'show', toc: 'toc', find: 'find', resume: 'resume' }[cmd];
  if (!run) { console.error(`unknown command: ${cmd}\n\n${USAGE}`); process.exit(2); }
  const result = await api[run](args);
  output(cmd, result, flags);
}

function output(cmd, result, flags) {
  const asJson = flags.json || !process.stdout.isTTY;
  console.log(asJson ? JSON.stringify(result, null, 2) : human(cmd === 'path' ? 'health' : cmd, result));
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
