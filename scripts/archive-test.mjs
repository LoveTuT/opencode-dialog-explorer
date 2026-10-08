import assert from 'node:assert/strict';
import { archiveIndex, sessionMessages, questionToc, aroundMessage, archiveSearch, finalAnswerIds } from '../server/archive.js';
import { updateMeta } from '../server/meta.js';
import { renameSession } from '../server/rename.js';

const { projects, sessions } = archiveIndex();
assert.equal(new Set(projects.map((p) => p.id)).size, projects.length);
assert.equal(new Set(sessions.map((s) => s.id)).size, sessions.length);
assert(sessions.every((s) => projects.some((p) => p.id === s.projectId)));
assert(sessions.every((s) => s.messageCount > 0));
assert.throws(() => sessionMessages('ses_../../invalid'), /invalid session id/);
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
    assert.equal(located.messages[0].id, target);
    if (located.hasMore) {
      const older = sessionMessages(sample.id, { cursor: located.nextCursor, limit: 10 });
      assert(!older.messages.some((m) => located.messages.some((n) => n.id === m.id)));
      assert(Date.parse(older.messages.at(-1).createdAt) <= Date.parse(located.messages[0].createdAt));
    }
    const middle = toc[Math.floor(toc.length / 2)].messageId;
    assert.equal(aroundMessage(sample.id, middle).messages[0].id, middle);
  }
  const search = archiveSearch(sample.id, { scope: 'metadata' });
  assert(search.results.some((r) => r.sessionId === sample.id));
}
console.log(`archive: ${projects.length} projects · ${sessions.length} sessions · PASS`);
