import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(import.meta.dirname, '../data/meta.json');
let queue = Promise.resolve();

export function readMeta() {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { projects: data.projects || {}, sessions: data.sessions || {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { projects: {}, sessions: {} };
    throw error;
  }
}

export function updateMeta(kind, id, patch) {
  if (!['projects', 'sessions'].includes(kind) || !id || id.length > 300) throw new Error('invalid metadata target');
  const allowed = kind === 'projects' ? ['pinned', 'alias', 'note'] : ['pinned', 'tags', 'note'];
  if (!patch || !Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.includes(key))) throw new Error('invalid metadata');
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'pinned' && typeof value !== 'boolean') throw new Error('invalid pinned');
    if (['note', 'alias'].includes(key) && (typeof value !== 'string' || value.length > 2000)) throw new Error('invalid text');
    if (key === 'tags' && (!Array.isArray(value) || value.length > 12 || value.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 40))) throw new Error('invalid tags');
  }
  const job = queue.catch(() => {}).then(() => {
    const data = readMeta();
    data[kind][id] = { ...data[kind][id], ...patch };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(data, null, 2));
      fs.renameSync(temp, file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    return data[kind][id];
  });
  queue = job;
  return job;
}
