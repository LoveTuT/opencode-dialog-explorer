// opencode: $XDG_DATA_HOME/opencode/opencode.db or ~/.local/share/opencode/opencode.db (SQLite).
//   session(id, parent_id, title, directory, time_updated)
//   message(id, session_id, time_created, data)   data.role = user|assistant
//   part(id, message_id, data)                    data.type = text|tool|reasoning|…
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { opencodeDbPath } from '../opencode-path.js';
import { makeEntry, resumeCommand, toolUseLine, toolResultLine, thinkingLine, clip } from './_shared.js';

const DB_PATH = opencodeDbPath();
export const source = 'opencode';

let _db = null;
function db() {
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) return null;
  try { _db = new DatabaseSync(DB_PATH, { readOnly: true }); } catch { _db = null; }
  return _db;
}

function partText(data) {
  let p; try { p = JSON.parse(data); } catch { return ''; }
  switch (p.type) {
    case 'text': return typeof p.text === 'string' ? p.text : '';
    case 'reasoning': return p.text ? thinkingLine(p.text) : '';
    case 'tool': {
      const st = p.state || {};
      let line = toolUseLine(p.tool, st.input);
      const out = st.output;
      if (typeof out === 'string' && out.trim()) line += '\n' + toolResultLine(out);
      return line;
    }
    case 'file': return '📎 [file] ' + clip(p.filename || p.url || '', 120);
    default: return ''; // step-start/step-finish/patch/compaction: noise for a preview
  }
}

export async function list() {
  const d = db();
  if (!d) return [];
  let sessions = [];
  try {
    sessions = d.prepare(
      `SELECT id, title, directory, time_updated FROM session WHERE parent_id IS NULL`
    ).all();
  } catch { return []; }

  const counts = new Map();
  try {
    for (const r of d.prepare(`SELECT session_id AS sid, count(*) AS c FROM message GROUP BY session_id`).all()) {
      counts.set(r.sid, r.c);
    }
  } catch {}

  const out = [];
  for (const s of sessions) {
    const c = counts.get(s.id) || 0;
    if (c === 0) continue;
    const cwd = s.directory || '';
    out.push(makeEntry({
      source, id: s.id, ref: s.id,
      title: s.title, cwd, gitBranch: null,
      messageCount: c,
      lastActivity: s.time_updated ? new Date(Number(s.time_updated)).toISOString() : null,
      mtimeMs: Number(s.time_updated) || 0,
      resume: resumeCommand(cwd, s.id),
    }));
  }
  return out;
}

export async function detail(ref, lastN = 30) {
  if (!/^ses_[A-Za-z0-9]+$/.test(ref)) throw new Error('forbidden');
  const d = db();
  if (!d) return { source, id: ref, title: '(unavailable)', projectPath: '', messages: [] };

  const s = d.prepare(`SELECT id, title, directory FROM session WHERE id = ?`).get(ref) || {};
  const cwd = s.directory || '';
  const rows = d.prepare(
    `SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT ?`
  ).all(ref, lastN).reverse();

  const partStmt = d.prepare(
    `SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC`
  );
  const messages = [];
  for (const m of rows) {
    let md; try { md = JSON.parse(m.data); } catch { md = {}; }
    const role = md.role === 'user' ? 'user' : 'assistant';
    const segs = [];
    for (const pr of partStmt.all(m.id)) {
      const txt = partText(pr.data);
      if (txt) segs.push(txt);
    }
    messages.push({ role, text: segs.join('\n').trim() });
  }
  return {
    source, id: ref, title: s.title || '(untitled)', projectPath: cwd, gitBranch: null,
    resume: resumeCommand(cwd, ref),
    messages,
  };
}
