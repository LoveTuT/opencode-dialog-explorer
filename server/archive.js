import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readMeta } from './meta.js';
import { opencodeDbPath } from './opencode-path.js';
import { resumeCommand } from './sources/_shared.js';

const file = opencodeDbPath();
const sessionId = /^ses_[A-Za-z0-9]+$/;
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

function projectId(row) { return `project:${row.project_id}`; }
function iso(value) { return value ? new Date(Number(value)).toISOString() : null; }

function sessionRow(row, metadata) {
  return {
    id: row.id, projectId: projectId(row), title: row.title,
    directory: row.directory, lastActivity: iso(row.time_updated),
    messageCount: row.message_count, resume: resumeCommand(row.directory, row.id),
    ...(process.platform === 'win32' ? { resumeShell: 'PowerShell' } : {}),
    ...metadata.sessions[row.id],
  };
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
  const sessions = rows.map((row) => sessionRow(row, metadata));
  const sourceProjects = new Map(d.prepare('SELECT id, name, worktree FROM project').all().map((p) => [p.id, p]));
  const projects = new Map();
  for (const s of sessions) {
    if (!projects.has(s.projectId)) {
      const original = sourceProjects.get(s.projectId.slice(8));
      projects.set(s.projectId, {
        id: s.projectId, name: original?.name || path.basename(s.directory) || '未命名项目',
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
  const finalAnswers = finalAnswerIds(d.prepare(`SELECT m.id, json_extract(m.data, '$.role') AS role,
    EXISTS (SELECT 1 FROM part p WHERE p.message_id=m.id AND json_extract(p.data, '$.type')='text'
      AND trim(coalesce(json_extract(p.data, '$.text'), '')) != '') AS hasText
    FROM message m WHERE m.session_id=? ORDER BY m.time_created, m.id`).all(id));
  const messages = page.map((m) => {
    const parts = d.prepare('SELECT data FROM part WHERE message_id=? ORDER BY time_created, id').all(m.id)
      .map(({ data }) => parse(data)).flatMap((p) => {
        if (p.type === 'text' || p.type === 'reasoning') return [{ type: p.type, text: p.text || '' }];
        if (p.type === 'tool') return [{ type: 'tool', name: p.tool || 'tool', input: p.state?.input, output: p.state?.output || '' }];
        if (p.type === 'file') return [{ type: 'file', text: p.filename || p.url || '附件' }];
        return [];
      });
    return { id: m.id, role: parse(m.data).role === 'user' ? 'user' : 'assistant', createdAt: iso(m.time_created), parts,
      finalAnswer: finalAnswers.has(m.id) };
  });
  if (!from) messages.reverse();
  return {
    id, title: s.title, projectId: `project:${s.project_id}`, directory: s.directory,
    resume: resumeCommand(s.directory, id),
    ...(process.platform === 'win32' ? { resumeShell: 'PowerShell' } : {}),
    messages,
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

export function aroundMessage(id, messageId) {
  return { ...sessionMessages(id, { from: messageId, limit: 100 }), jumped: true };
}

export function archiveSearch(query, { project = '', scope = 'all', limit = 100 } = {}) {
  const q = String(query || '').trim().slice(0, 200);
  const { projects, sessions } = archiveIndex();
  const terms = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = sessions.filter((s) => !project || s.projectId === project);
  if (!terms.length) return { results: [], total: 0 };
  const matches = (text) => terms.every((t) => String(text || '').toLocaleLowerCase().includes(t));
  const results = [];
  const eligible = new Map(filtered.map((s) => [s.id, s]));
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  if (scope !== 'content') {
    for (const s of filtered) {
      const p = projectMap.get(s.projectId);
      const fields = [s.title, s.directory, s.id, s.note, ...(s.tags || []), p?.name, p?.alias].filter(Boolean);
      if (matches(fields.join(' '))) {
        const snippets = [...new Set(terms.map((term) => fields.find((field) => field.toLocaleLowerCase().includes(term))))];
        results.push({ sessionId: s.id, projectId: s.projectId, title: s.title, projectName: p?.alias || p?.name,
          snippet: snippets.map((field) => {
            const pos = field.toLocaleLowerCase().indexOf(terms.find((term) => field.toLocaleLowerCase().includes(term)));
            return field.slice(Math.max(0, pos - 60), pos + 140);
          }).join(' · '), matchField: 'metadata', updatedAt: s.lastActivity });
      }
    }
  }
  if (scope !== 'metadata') {
    const d = db();
    // Let SQLite filter the text before crossing the JS boundary: transferring
    // every part (including large transcripts) took tens of seconds on first search.
    const clause = terms.map(() => "instr(lower(json_extract(p.data,'$.text')), ?) > 0").join(' AND ');
    const rows = d?.prepare(`SELECT p.message_id, p.session_id, json_extract(p.data,'$.text') AS text
      FROM part p JOIN session s ON s.id=p.session_id
      WHERE s.parent_id IS NULL AND json_extract(p.data,'$.type')='text' AND ${clause}`)
      .iterate(...terms) || [];
    const seen = new Set();
    for (const row of rows) {
      const s = eligible.get(row.session_id);
      if (!s || seen.has(s.id)) continue;
      const pos = String(row.text).toLocaleLowerCase().indexOf(terms[0]);
      const p = projectMap.get(s.projectId);
      const match = { sessionId: s.id, projectId: s.projectId, messageId: row.message_id,
        title: s.title, projectName: p?.alias || p?.name,
        snippet: String(row.text).slice(Math.max(0, pos - 60), pos + 140).replace(/\s+/g, ' '),
        matchField: 'content', updatedAt: s.lastActivity };
      const existing = results.findIndex((r) => r.sessionId === s.id);
      if (existing === -1) results.push(match);
      else results[existing] = match;
      seen.add(s.id);
    }
  }
  results.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return { results: results.slice(0, Math.min(500, Math.max(1, Number(limit) || 100))), total: results.length };
}
