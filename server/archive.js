import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readMeta } from './meta.js';
import { opencodeDbPath } from './opencode-path.js';

const file = opencodeDbPath();
const sessionId = /^ses_[A-Za-z0-9]+$/;
const SEARCH_CAP = 1000;
let connection;

function db() {
  if (!fs.existsSync(file)) return null;
  if (!connection) connection = new DatabaseSync(file, { readOnly: true });
  return connection;
}

function valid(id) {
  if (!sessionId.test(id || '')) throw new Error('invalid session id');
}

function parse(data) {
  try { return JSON.parse(data); } catch { return {}; }
}

function iso(value) { return value ? new Date(Number(value)).toISOString() : null; }

// Pass the project directory directly to OpenCode so Windows need not switch drives with `cd`.
export function resumeCommand(cwd, id, platform = process.platform) {
  if (!cwd) return `opencode --session ${id}`;
  if (platform === 'win32') return `opencode '${cwd.replaceAll("'", "''")}' --session ${id}`;
  return `opencode '${cwd.replaceAll("'", "'\\''")}' --session ${id}`;
}

// Identity: prefer the stable opencode project id. When a build has no project
// table / project_id, fall back to a hash of the full normalised directory and
// flag it, so same-named folders are never silently merged.
function normalizeDirectory(dir) {
  if (!dir) return '';
  const normalized = String(dir).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function directoryIdentity(directory) {
  const hash = createHash('sha1').update(normalizeDirectory(directory)).digest('hex').slice(0, 12);
  return `dir:${hash}`;
}

function identity(row) {
  if (row.project_id != null && row.project_id !== '') {
    return { id: `project:${row.project_id}`, identitySource: 'project_id' };
  }
  return { id: directoryIdentity(row.directory), identitySource: 'directory' };
}

function sessionRow(row, metadata, questions) {
  const who = identity(row);
  return {
    id: row.id, projectId: who.id, identitySource: who.identitySource,
    title: row.title, directory: row.directory,
    lastActivity: iso(row.time_updated), messageCount: row.message_count,
    firstQuestion: questions.get(row.id) || '',
    resume: resumeCommand(row.directory, row.id),
    ...(process.platform === 'win32' ? { resumeShell: 'PowerShell' } : {}),
    ...metadata.sessions[row.id],
  };
}

// First user question per session, for the session list preview. Uses a window
// function and degrades to no preview on builds without one.
function firstQuestionMap(d) {
  const map = new Map();
  try {
    const rows = d.prepare(`SELECT t.sid AS sid,
      (SELECT json_extract(p.data,'$.text') FROM part p
        WHERE p.message_id=t.mid AND json_extract(p.data,'$.type')='text'
        ORDER BY p.time_created, p.id LIMIT 1) AS text
      FROM (SELECT m.session_id AS sid, m.id AS mid,
              ROW_NUMBER() OVER (PARTITION BY m.session_id ORDER BY m.time_created, m.id) AS rn
            FROM message m WHERE json_extract(m.data,'$.role')='user') t
      WHERE t.rn=1`).all();
    for (const r of rows) {
      const text = String(r.text || '').replace(/\s+/g, ' ').trim();
      if (text) map.set(r.sid, text.slice(0, 120));
    }
  } catch { /* SQLite without window functions: no preview */ }
  return map;
}

const sessionQuery = `SELECT s.id, s.project_id, s.title, s.directory, s.time_updated,
  (SELECT count(*) FROM message WHERE session_id=s.id) AS message_count
  FROM session s WHERE s.parent_id IS NULL AND EXISTS (SELECT 1 FROM message WHERE session_id=s.id)`;

export function finalAnswerIds(rows) {
  const ids = new Set();
  let answer;
  let inTurn = false;
  for (const row of rows) {
    if (row.role === 'user') {
      if (answer) ids.add(answer);
      answer = null;
      inTurn = true;
    } else if (inTurn && row.role === 'assistant' && row.hasText) {
      answer = row.id;
    }
  }
  if (answer) ids.add(answer);
  return ids;
}

export function archiveIndex() {
  const d = db();
  if (!d) return { projects: [], sessions: [] };
  const metadata = readMeta();
  const rows = d.prepare(sessionQuery).all();
  const questions = firstQuestionMap(d);
  const sessions = rows.map((row) => sessionRow(row, metadata, questions));
  let sourceProjects = new Map();
  try {
    sourceProjects = new Map(d.prepare('SELECT id, name, worktree FROM project').all().map((p) => [p.id, p]));
  } catch { /* builds without a project table fall back to directory identity */ }
  const projects = new Map();
  for (const s of sessions) {
    if (!projects.has(s.projectId)) {
      const original = s.identitySource === 'project_id' ? sourceProjects.get(s.projectId.slice(8)) : null;
      const base = normalizeDirectory(s.directory).split('/').filter(Boolean).pop();
      projects.set(s.projectId, {
        id: s.projectId, identitySource: s.identitySource,
        name: original?.name || base || '未命名项目',
        worktree: original?.worktree || '', paths: [], sessionCount: 0,
        lastActivity: null, ...metadata.projects[s.projectId],
      });
    }
    const p = projects.get(s.projectId);
    p.sessionCount++;
    if (!p.paths.includes(s.directory)) p.paths.push(s.directory);
    if (!p.lastActivity || s.lastActivity > p.lastActivity) p.lastActivity = s.lastActivity;
  }
  return { projects: [...projects.values()].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.lastActivity || '').localeCompare(a.lastActivity || '')), sessions };
}

function sessionSort(list, sort) {
  const byPin = (a, b) => Number(!!b.pinned) - Number(!!a.pinned);
  const cmp = sort === 'title' ? (a, b) => a.title.localeCompare(b.title)
    : sort === 'messages' ? (a, b) => b.messageCount - a.messageCount
      : sort === 'oldest' ? (a, b) => (a.lastActivity || '').localeCompare(b.lastActivity || '')
        : (a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || '');
  return [...list].sort((a, b) => byPin(a, b) || cmp(a, b));
}

// Server-side paginated session list for one project. Pinned first, then the
// requested sort; supports working-directory and text filters.
export function projectSessions(projectId, { cursor = 0, limit = 30, sort = 'recent', directory = '', q = '' } = {}) {
  const { sessions } = archiveIndex();
  let list = sessions.filter((s) => s.projectId === projectId);
  if (directory) list = list.filter((s) => s.directory === directory);
  const query = String(q || '').toLocaleLowerCase();
  if (query) list = list.filter((s) => s.title.toLocaleLowerCase().includes(query) || (s.firstQuestion || '').toLocaleLowerCase().includes(query));
  list = sessionSort(list, sort);
  const total = list.length;
  const offset = Math.max(0, Number(cursor) || 0);
  const size = Math.min(100, Math.max(1, Number(limit) || 30));
  const page = list.slice(offset, offset + size);
  const hasMore = offset + size < total;
  return { sessions: page, total, hasMore, nextCursor: hasMore ? offset + size : null };
}

// Turn message rows into the structured shape the reader renders. `rows` must
// be in ascending time order.
function hydrate(d, id, rows) {
  const finalAnswers = finalAnswerIds(d.prepare(`SELECT m.id, json_extract(m.data, '$.role') AS role,
    EXISTS (SELECT 1 FROM part p WHERE p.message_id=m.id AND json_extract(p.data, '$.type')='text'
      AND trim(coalesce(json_extract(p.data, '$.text'), '')) != '') AS hasText
    FROM message m WHERE m.session_id=? ORDER BY m.time_created, m.id`).all(id));
  const partStmt = d.prepare('SELECT data FROM part WHERE message_id=? ORDER BY time_created, id');
  return rows.map((m) => {
    const parts = partStmt.all(m.id).map(({ data }) => parse(data)).flatMap((p) => {
      if (p.type === 'text' || p.type === 'reasoning') return [{ type: p.type, text: p.text || '' }];
      if (p.type === 'tool') return [{ type: 'tool', name: p.tool || 'tool', input: p.state?.input, output: p.state?.output || '' }];
      if (p.type === 'file') return [{ type: 'file', text: p.filename || p.url || '附件' }];
      return [];
    });
    return { id: m.id, role: parse(m.data).role === 'user' ? 'user' : 'assistant', createdAt: iso(m.time_created), parts,
      finalAnswer: finalAnswers.has(m.id) };
  });
}

function sessionHeader(s) {
  const who = identity(s);
  return {
    id: s.id, title: s.title, projectId: who.id, identitySource: who.identitySource, directory: s.directory,
    resume: resumeCommand(s.directory, s.id),
    ...(process.platform === 'win32' ? { resumeShell: 'PowerShell' } : {}),
  };
}

export function sessionMessages(id, { cursor, limit = 40, from } = {}) {
  valid(id);
  const d = db();
  if (!d) throw new Error('database unavailable');
  const s = d.prepare('SELECT id, title, directory, project_id FROM session WHERE id=? AND parent_id IS NULL').get(id);
  if (!s) throw new Error('session not found');
  const size = Math.min(100, Math.max(1, Number(limit) || 40));
  const boundary = cursor || from
    ? d.prepare('SELECT time_created, id FROM message WHERE id=? AND session_id=?').get(cursor || from, id)
    : null;
  if ((cursor || from) && !boundary) throw new Error('message not found');
  const rows = from
    ? d.prepare(`SELECT id, data, time_created FROM message WHERE session_id=?
      AND (time_created > ? OR (time_created = ? AND id >= ?))
      ORDER BY time_created, id LIMIT ?`).all(id, boundary.time_created, boundary.time_created, boundary.id, size)
    : d.prepare(`SELECT id, data, time_created FROM message WHERE session_id=?
      ${boundary ? 'AND (time_created < ? OR (time_created = ? AND id < ?))' : ''}
      ORDER BY time_created DESC, id DESC LIMIT ?`).all(...(boundary ? [id, boundary.time_created, boundary.time_created, boundary.id, size + 1] : [id, size + 1]));
  const more = from
    ? !!d.prepare(`SELECT 1 FROM message WHERE session_id=? AND (time_created < ? OR (time_created = ? AND id < ?)) LIMIT 1`)
      .get(id, boundary.time_created, boundary.time_created, boundary.id)
    : rows.length > size;
  const page = rows.slice(0, size);
  const ordered = from ? page : page.slice().reverse();
  return {
    ...sessionHeader(s),
    messages: hydrate(d, id, ordered),
    hasMore: more, nextCursor: more ? (from ? boundary.id : page[page.length - 1].id) : null,
  };
}

export function questionToc(id) {
  valid(id);
  const d = db();
  if (!d) return [];
  if (!d.prepare('SELECT id FROM session WHERE id=? AND parent_id IS NULL').get(id)) throw new Error('session not found');
  const rows = d.prepare(`SELECT m.id, m.time_created,
    (SELECT json_extract(p.data,'$.text') FROM part p WHERE p.message_id=m.id
      AND json_extract(p.data,'$.type')='text' ORDER BY p.time_created,p.id LIMIT 1) AS text
    FROM message m WHERE m.session_id=? AND json_extract(m.data,'$.role')='user'
    ORDER BY m.time_created,m.id`).all(id);
  return rows.map((r, i) => ({ seq: i + 1, messageId: r.id, createdAt: iso(r.time_created), preview: (r.text || `用户提问 #${i + 1}`).slice(0, 80) }));
}

// In-session find: every message whose text contains the literal query (case-
// insensitive), one hit per message, in reading order, with a snippet.
export function findInSession(id, query, { limit = 500 } = {}) {
  valid(id);
  const q = String(query || '').trim().slice(0, 200);
  const d = db();
  if (!d) throw new Error('database unavailable');
  if (!d.prepare('SELECT id FROM session WHERE id=? AND parent_id IS NULL').get(id)) throw new Error('session not found');
  if (!q) return [];
  const needle = q.toLocaleLowerCase();
  const rows = d.prepare(`SELECT p.message_id AS message_id,
    json_extract(p.data,'$.text') AS text
    FROM part p JOIN message m ON m.id=p.message_id
    WHERE p.session_id=? AND json_extract(p.data,'$.type')='text'
      AND instr(lower(json_extract(p.data,'$.text')), ?) > 0
    ORDER BY m.time_created, m.id, p.time_created, p.id`).all(id, needle);
  const hits = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.message_id)) continue;
    seen.add(row.message_id);
    const text = String(row.text || '');
    const pos = text.toLocaleLowerCase().indexOf(needle);
    hits.push({ seq: hits.length + 1, messageId: row.message_id, snippet: text.slice(Math.max(0, pos - 40), pos + q.length + 60).replace(/\s+/g, ' ') });
    if (hits.length >= limit) break;
  }
  return hits;
}

// SQL point window: fetch the messages immediately around a hit in one query
// instead of paging toward it, so deep links resolve without walking history.
export function aroundMessage(id, messageId, { limit = 100 } = {}) {
  valid(id);
  const d = db();
  if (!d) throw new Error('database unavailable');
  const s = d.prepare('SELECT id, title, directory, project_id FROM session WHERE id=? AND parent_id IS NULL').get(id);
  if (!s) throw new Error('session not found');
  const target = d.prepare('SELECT time_created, id FROM message WHERE id=? AND session_id=?').get(messageId, id);
  if (!target) throw new Error('message not found');
  const size = Math.min(200, Math.max(3, Number(limit) || 100));
  const before = Math.floor((size - 1) / 2);
  const after = size - 1 - before;
  const older = d.prepare(`SELECT id, data, time_created FROM message WHERE session_id=?
    AND (time_created < ? OR (time_created = ? AND id < ?))
    ORDER BY time_created DESC, id DESC LIMIT ?`).all(id, target.time_created, target.time_created, target.id, before).reverse();
  const hit = d.prepare('SELECT id, data, time_created FROM message WHERE id=?').get(messageId);
  const newer = d.prepare(`SELECT id, data, time_created FROM message WHERE session_id=?
    AND (time_created > ? OR (time_created = ? AND id > ?))
    ORDER BY time_created, id LIMIT ?`).all(id, target.time_created, target.time_created, target.id, after);
  const rows = [...older, hit, ...newer];
  const oldest = rows[0];
  const hasMore = !!d.prepare(`SELECT 1 FROM message WHERE session_id=? AND (time_created < ? OR (time_created = ? AND id < ?)) LIMIT 1`)
    .get(id, oldest.time_created, oldest.time_created, oldest.id);
  return {
    ...sessionHeader(s),
    messages: hydrate(d, id, rows),
    hasMore, nextCursor: hasMore ? oldest.id : null, jumped: true,
  };
}

const METADATA_FIELDS = [
  ['title', 100], ['project', 80], ['path', 50], ['tags', 40], ['note', 40], ['id', 30],
];

function metadataHit(s, project, terms) {
  const lower = (v) => String(v || '').toLocaleLowerCase();
  const values = {
    title: s.title, project: project?.alias || project?.name, path: s.directory,
    tags: (s.tags || []).join(' '), note: s.note, id: s.id,
  };
  let best = null;
  for (const [field, base] of METADATA_FIELDS) {
    const value = values[field];
    if (!value || !terms.every((t) => lower(value).includes(t))) continue;
    const exact = lower(value) === terms.join(' ');
    const score = base + (exact ? 20 : 0);
    if (!best || score > best.score) {
      const pos = lower(value).indexOf(terms[0]);
      best = { matchField: field, score, snippet: value.slice(Math.max(0, pos - 60), pos + 140) };
    }
  }
  return best;
}

export function archiveSearch(query, { project = '', scope = 'all', sort = 'recent', cursor = 0, limit = 50 } = {}) {
  const q = String(query || '').trim().slice(0, 200);
  const terms = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const offset = Math.max(0, Number(cursor) || 0);
  const size = Math.min(100, Math.max(1, Number(limit) || 50));
  const meta = { query: q, scope, sort };
  if (!terms.length) return { ...meta, results: [], total: 0, nextCursor: null, hasMore: false, truncated: false };
  const { projects, sessions } = archiveIndex();
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const filtered = sessions.filter((s) => !project || s.projectId === project);
  const eligible = new Map(filtered.map((s) => [s.id, s]));
  const results = [];
  if (scope !== 'content') {
    for (const s of filtered) {
      const p = projectMap.get(s.projectId);
      const hit = metadataHit(s, p, terms);
      if (hit) results.push({ scope: 'metadata', sessionId: s.id, projectId: s.projectId, messageId: null,
        title: s.title, projectName: p?.alias || p?.name, snippet: hit.snippet, matchField: hit.matchField,
        score: hit.score, updatedAt: s.lastActivity });
    }
  }
  let truncated = false;
  if (scope !== 'metadata') {
    const d = db();
    // Let SQLite filter the text before crossing the JS boundary: transferring
    // every part (including large transcripts) took tens of seconds on first search.
    const clause = terms.map(() => "instr(lower(json_extract(p.data,'$.text')), ?) > 0").join(' AND ');
    let rows = [];
    if (d) {
      rows = [...d.prepare(`SELECT p.message_id AS message_id, p.session_id AS session_id,
        json_extract(p.data,'$.text') AS text
        FROM part p JOIN session s ON s.id=p.session_id
        WHERE s.parent_id IS NULL AND json_extract(p.data,'$.type')='text' AND ${clause}
        LIMIT ?`).iterate(...terms, SEARCH_CAP)];
      truncated = rows.length >= SEARCH_CAP;
    }
    const seen = new Set();
    for (const row of rows) {
      const s = eligible.get(row.session_id);
      if (!s) continue;
      const key = `${s.id}:${row.message_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = String(row.text || '');
      const pos = text.toLocaleLowerCase().indexOf(terms[0]);
      const p = projectMap.get(s.projectId);
      results.push({ scope: 'content', sessionId: s.id, projectId: s.projectId, messageId: row.message_id,
        title: s.title, projectName: p?.alias || p?.name,
        snippet: text.slice(Math.max(0, pos - 60), pos + 140).replace(/\s+/g, ' '),
        matchField: 'content', score: 20, updatedAt: s.lastActivity });
    }
  }
  if (sort === 'relevance') results.sort((a, b) => b.score - a.score || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  else results.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || b.score - a.score);
  const total = results.length;
  const page = results.slice(offset, offset + size);
  const hasMore = offset + size < total;
  return { ...meta, results: page, total, nextCursor: hasMore ? offset + size : null, hasMore, truncated };
}
