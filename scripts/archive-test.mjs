import assert from 'node:assert/strict';
import { archiveIndex, projectSessions, sessionMessages, questionToc, aroundMessage, findInSession, archiveSearch, finalAnswerIds, sessionSort, sortProjects } from '../server/archive.js';
import { updateMeta, updateOrder } from '../server/meta.js';
import { renameSession } from '../server/rename.js';

const { projects, sessions } = archiveIndex();
assert.equal(new Set(projects.map((p) => p.id)).size, projects.length);
assert.equal(new Set(sessions.map((s) => s.id)).size, sessions.length);
assert(sessions.every((s) => projects.some((p) => p.id === s.projectId)));
assert(sessions.every((s) => s.messageCount > 0));
assert(sessions.every((s) => typeof s.firstQuestion === 'string'));
assert.throws(() => sessionMessages('ses_../../invalid'), /invalid session id/);
assert.throws(() => findInSession('ses_../../invalid', 'x'), /invalid session id/);
assert.throws(() => renameSession('ses_../../invalid', 'title'), /invalid session id/);
assert.throws(() => updateMeta('sessions', 'test', { tags: [''] }), /invalid tags/);
assert.deepEqual([...finalAnswerIds([
  { id: 'q1', role: 'user' },
  { id: 'a1', role: 'assistant', hasText: 1 },
  { id: 'tool', role: 'assistant', hasText: 0 },
  { id: 'a2', role: 'assistant', hasText: 1 },
  { id: 'q2', role: 'user' },
  { id: 'reasoning', role: 'assistant', hasText: 0 },
  { id: 'q3', role: 'user' },
  { id: 'a3', role: 'assistant', hasText: 1 },
])], ['a2', 'a3']);

// custom pinned order (sidecar display only)
const item = (id, pinned, order, lastActivity) => ({ id, pinned, order, lastActivity, title: id, messageCount: 1 });
assert.deepEqual(
  sessionSort([item('c', false, undefined, '2024-03-01'), item('a', true, 2, '2024-01-01'), item('b', true, 0, '2024-02-01'), item('d', false, undefined, '2024-04-01')], 'recent').map((s) => s.id),
  ['b', 'a', 'd', 'c']);
assert.deepEqual(
  sortProjects([item('x', true, 5, '2024-01-01'), item('y', true, 1, '2020-01-01'), item('z', false, undefined, '2025-01-01')]).map((p) => p.id),
  ['y', 'x', 'z']);
assert.deepEqual(
  sessionSort([item('n', true, undefined, '2024-05-01'), item('o', true, 0, '2024-01-01')], 'recent').map((s) => s.id),
  ['o', 'n']);
assert.throws(() => updateOrder('bad', ['x']), /invalid metadata target/);
assert.throws(() => updateOrder('projects', []), /invalid order list/);
assert.throws(() => updateOrder('projects', ['a', 'a']), /duplicate ids/);
assert.throws(() => updateOrder('projects', ['']), /invalid order id/);
assert.throws(() => updateMeta('sessions', 'test', { order: -1 }), /invalid order/);
assert.throws(() => updateMeta('sessions', 'test', { order: 1.5 }), /invalid order/);

if (sessions.length) {
  const sample = sessions.find((s) => s.messageCount > 40) || sessions[0];
  const page = sessionMessages(sample.id, { limit: 10 });
  assert(page.messages.length > 0 && page.messages.length <= 10);
  assert(page.messages.every((m) => m.id && m.createdAt && Array.isArray(m.parts)));
  if (page.hasMore) {
    const older = sessionMessages(sample.id, { limit: 10, cursor: page.nextCursor });
    assert(older.messages.every((m) => !page.messages.some((n) => n.id === m.id)));
    assert(Date.parse(older.messages.at(-1).createdAt) <= Date.parse(page.messages[0].createdAt));
    assert(page.messages.every((m) => m.finalAnswer === sessionMessages(sample.id, { limit: 100 }).messages.find((n) => n.id === m.id)?.finalAnswer));
  }
  const toc = questionToc(sample.id);
  if (toc.length) {
    const target = toc[0].messageId;
    const located = aroundMessage(sample.id, target);
    assert(located.messages.some((m) => m.id === target));
    assert(located.jumped === true);
    if (located.hasMore) {
      const older = sessionMessages(sample.id, { cursor: located.nextCursor, limit: 10 });
      const oldest = located.messages[0];
      assert(!older.messages.some((m) => located.messages.some((n) => n.id === m.id)));
      assert(Date.parse(older.messages.at(-1).createdAt) <= Date.parse(oldest.createdAt));
    }
    const middle = toc[Math.floor(toc.length / 2)].messageId;
    assert(aroundMessage(sample.id, middle).messages.some((m) => m.id === middle));
  }
  const search = archiveSearch(sample.id, { scope: 'metadata' });
  const meta = search.results.find((r) => r.sessionId === sample.id);
  assert(meta, 'metadata search should find session by id');
  assert(['scope', 'projectId', 'sessionId', 'snippet', 'matchField', 'score', 'updatedAt'].every((f) => f in meta));
  const content = archiveSearch('e', { scope: 'content', limit: 5 });
  assert(content.results.every((r) => r.scope === 'content' && r.messageId && r.matchField === 'content'));
  assert(content.total >= content.results.length);
  assert(typeof content.hasMore === 'boolean' && typeof archiveSearch('', {}).total === 'number');
  const findTerm = (toc[0]?.preview || '').slice(0, 6);
  if (findTerm) {
    const hits = findInSession(sample.id, findTerm);
    assert(Array.isArray(hits) && hits.every((h) => h.messageId && typeof h.snippet === 'string'));
    assert(hits.every((h, i) => h.seq === i + 1));
    assert.deepEqual(findInSession(sample.id, 'zzqqxxnotarealword'), []);
  }
}
if (projects.length) {
  const first = projectSessions(projects[0].id, { limit: 2 });
  assert(first.sessions.length <= 2 && first.sessions.every((s) => s.projectId === projects[0].id));
  assert(first.total >= first.sessions.length);
  if (first.hasMore) {
    const next = projectSessions(projects[0].id, { limit: 2, cursor: first.nextCursor });
    assert(next.sessions.every((s) => !first.sessions.some((n) => n.id === s.id)));
  }
}
console.log(`archive: ${projects.length} projects · ${sessions.length} sessions · PASS`);
