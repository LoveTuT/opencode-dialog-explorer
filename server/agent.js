import fs from 'node:fs';
import {
  archiveIndex, archiveSearch, recentSessions, sessionMeta, sessionMessages, questionToc, findInSession,
} from './archive.js';
import { opencodeDbPath } from './opencode-path.js';

// Machine-facing adapter over the same read-only archive core the UI uses. It
// returns compact, stable JSON with deep links back into the human interface;
// it never writes to the OpenCode database.

export const SCHEMA_VERSION = 1;

function serviceUrl() {
  return String(process.env.OCDE_SERVICE_URL || 'http://127.0.0.1:4570').replace(/\/+$/, '');
}

function envelope(kind) {
  return { schemaVersion: SCHEMA_VERSION, kind };
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function sessionLink(projectId, id) {
  return `${serviceUrl()}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(id)}`;
}

function hitLink(sessionId, messageId) {
  const query = messageId ? `?message=${encodeURIComponent(messageId)}` : '';
  return `${serviceUrl()}/all/sessions/${encodeURIComponent(sessionId)}${query}`;
}

function projectLink(projectId) {
  return `${serviceUrl()}/projects/${encodeURIComponent(projectId)}`;
}

export function agentHealth() {
  const dbPath = opencodeDbPath();
  return { ...envelope('health'), ok: true, serviceUrl: serviceUrl(), dbPath, dbExists: fs.existsSync(dbPath) };
}

// archiveIndex aggregates every session and is comparatively slow, so cache it
// for a short window; agent callers tend to poll projects/recent repeatedly.
let projectsCache = { at: 0, data: [] };
const PROJECTS_TTL = 60_000;

export function agentProjects({ limit = 200 } = {}) {
  const now = Date.now();
  if (!projectsCache.data.length || now - projectsCache.at > PROJECTS_TTL) {
    projectsCache = { at: now, data: archiveIndex().projects };
  }
  const size = clamp(limit, 1, 1000, 200);
  const projects = projectsCache.data.slice(0, size).map((p) => ({
    id: p.id, name: p.alias || p.name, identitySource: p.identitySource,
    worktree: p.worktree || '', paths: p.paths || [], sessionCount: p.sessionCount,
    lastActivity: p.lastActivity, pinned: !!p.pinned, deepLink: projectLink(p.id),
  }));
  return { ...envelope('projects'), total: projectsCache.data.length, count: projects.length, projects };
}

// Cheap path (no first-question scan) unless `withQuestion` is requested, which
// switches to the full index for the richer preview.
function recentBase({ project, dir, limit, withQuestion }) {
  if (!withQuestion) return recentSessions({ project, directory: dir, limit });
  const { sessions } = archiveIndex();
  let list = sessions;
  if (project) list = list.filter((s) => s.projectId === project);
  if (dir) list = list.filter((s) => s.directory === dir);
  return [...list].sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || '')).slice(0, limit);
}

export function agentRecent({ project = '', dir = '', limit = 20, withQuestion = false } = {}) {
  const size = clamp(limit, 1, 200, 20);
  const list = recentBase({ project, dir, limit: size, withQuestion }).map((s) => ({
    id: s.id, title: s.title, projectId: s.projectId, identitySource: s.identitySource,
    directory: s.directory, updatedAt: s.lastActivity, messageCount: s.messageCount,
    pinned: !!s.pinned, resume: s.resume, deepLink: sessionLink(s.projectId, s.id),
    ...(withQuestion ? { firstQuestion: s.firstQuestion || '' } : {}),
  }));
  return { ...envelope('recent'), count: list.length, sessions: list };
}

export function agentSearch({ q, scope = 'all', project = '', limit = 50, sort = 'recent' } = {}) {
  const res = archiveSearch(q, { project, scope, sort, limit });
  const hits = res.results.map((r) => ({
    sessionId: r.sessionId, projectId: r.projectId, messageId: r.messageId,
    matchField: r.matchField, snippet: r.snippet, title: r.title,
    updatedAt: r.updatedAt, deepLink: hitLink(r.sessionId, r.messageId),
  }));
  return { ...envelope('search'), query: res.query, scope: res.scope, sort: res.sort,
    total: res.total, truncated: res.truncated, hasMore: res.hasMore, nextCursor: res.nextCursor, hits };
}

// Collapse message parts into a token-bounded transcript. Tool calls and
// reasoning become short markers unless `full` is set.
function compact(messages, { maxChars, full }) {
  let budget = maxChars;
  let truncated = false;
  const out = [];
  for (const m of messages) {
    const texts = [];
    const tools = [];
    for (const p of m.parts || []) {
      if (p.type === 'text') texts.push(p.text || '');
      else if (p.type === 'reasoning') { if (full) texts.push(p.text || ''); else tools.push('reasoning'); }
      else if (p.type === 'tool') tools.push(p.name || 'tool');
      else if (p.type === 'file') tools.push('file');
    }
    let text = texts.join('\n').trim();
    if (text.length > budget) { text = text.slice(0, Math.max(0, budget)); truncated = true; }
    budget -= text.length;
    const item = { id: m.id, role: m.role, at: m.createdAt, text };
    if (tools.length) item.tools = tools;
    out.push(item);
    if (budget <= 0) { if (m !== messages[messages.length - 1]) truncated = true; break; }
  }
  return { messages: out, truncated };
}

export function agentShow({ id, limit = 40, maxChars = 20000, cursor = '', full = false } = {}) {
  const size = clamp(limit, 1, 100, 40);
  const budget = clamp(maxChars, 500, 200000, 20000);
  const page = sessionMessages(id, { cursor, limit: size });
  const { messages, truncated } = compact(page.messages, { maxChars: budget, full });
  return {
    ...envelope('show'),
    session: { id: page.id, title: page.title, projectId: page.projectId, identitySource: page.identitySource,
      directory: page.directory, resume: page.resume, deepLink: sessionLink(page.projectId, page.id) },
    count: messages.length, messages, truncated, hasMore: page.hasMore, nextCursor: page.nextCursor,
  };
}

export function agentToc(id) {
  const items = questionToc(id).map((t) => ({ ...t, deepLink: hitLink(id, t.messageId) }));
  return { ...envelope('toc'), sessionId: id, count: items.length, items };
}

export function agentFind(id, q) {
  const items = findInSession(id, q).map((h) => ({ ...h, deepLink: hitLink(id, h.messageId) }));
  return { ...envelope('find'), sessionId: id, query: String(q || ''), count: items.length, hits: items };
}

export function agentResume(id) {
  const s = sessionMeta(id);
  return { ...envelope('resume'), id: s.id, directory: s.directory, command: s.resume,
    ...(s.resumeShell ? { shell: s.resumeShell } : {}) };
}

export function agentSessionMeta(id) {
  const s = sessionMeta(id);
  return { ...envelope('session'), session: { ...s, deepLink: sessionLink(s.projectId, s.id) } };
}
