import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(import.meta.dirname, '../data/meta.json');
let queue = Promise.resolve();

const FIELDS = {
  projects: ['pinned', 'alias', 'note', 'order'],
  sessions: ['pinned', 'tags', 'note', 'order'],
};

export function readMeta() {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { projects: data.projects || {}, sessions: data.sessions || {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { projects: {}, sessions: {} };
    throw error;
  }
}

// Atomic replace; callers must be serialized through `queue` (see below).
function writeMeta(data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function enqueue(job) {
  const run = queue.catch(() => {}).then(job);
  queue = run;
  return run;
}

export function updateMeta(kind, id, patch) {
  if (!FIELDS[kind] || !id || id.length > 300) throw new Error('invalid metadata target');
  const allowed = FIELDS[kind];
  if (!patch || !Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.includes(key))) throw new Error('invalid metadata');
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'pinned' && typeof value !== 'boolean') throw new Error('invalid pinned');
    if (['note', 'alias'].includes(key) && (typeof value !== 'string' || value.length > 2000)) throw new Error('invalid text');
    if (key === 'order' && (!Number.isInteger(value) || value < 0 || value > 100000)) throw new Error('invalid order');
    if (key === 'tags' && (!Array.isArray(value) || value.length > 12 || value.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 40))) throw new Error('invalid tags');
  }
  return enqueue(() => {
    const data = readMeta();
    data[kind][id] = { ...data[kind][id], ...patch };
    writeMeta(data);
    return data[kind][id];
  });
}

// Reorder items by assigning order = index. Only the given ids are touched;
// items not listed keep their existing order. Display-only (sidecar), never
// written back to the opencode database.
export function updateOrder(kind, ids) {
  if (!FIELDS[kind]) throw new Error('invalid metadata target');
  if (!Array.isArray(ids) || !ids.length || ids.length > 2000) throw new Error('invalid order list');
  if (new Set(ids).size !== ids.length) throw new Error('duplicate ids');
  for (const id of ids) if (typeof id !== 'string' || !id || id.length > 300) throw new Error('invalid order id');
  return enqueue(() => {
    const data = readMeta();
    ids.forEach((id, index) => { data[kind][id] = { ...data[kind][id], order: index }; });
    writeMeta(data);
    return { kind, count: ids.length };
  });
}
