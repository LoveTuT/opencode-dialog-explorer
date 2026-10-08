import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const file = path.join(os.homedir(), '.local/share/opencode/opencode.db');

export function renameSession(id, title) {
  if (!/^ses_[A-Za-z0-9]+$/.test(id || '')) throw new Error('invalid session id');
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || /[\x00-\x1f\x7f]/.test(title)) throw new Error('invalid title');
  if (!fs.existsSync(file)) throw new Error('database unavailable');
  const d = new DatabaseSync(file);
  try {
    d.exec('PRAGMA busy_timeout=3000');
    const result = d.prepare('UPDATE session SET title=? WHERE id=? AND parent_id IS NULL').run(title.trim(), id);
    if (!result.changes) throw new Error('session not found');
    return { id, title: title.trim() };
  } finally { d.close(); }
}
