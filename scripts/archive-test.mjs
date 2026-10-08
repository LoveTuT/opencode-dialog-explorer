import assert from 'node:assert/strict';
import { archiveIndex, sessionMessages, questionToc, aroundMessage, archiveSearch } from '../server/archive.js';
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

if (sessions.length) {
  const sample = sessions.find((s) => s.messageCount > 40) || sessions[0];
  const page = sessionMessages(sample.id, { limit: 10 });
  assert(page.messages.length > 0 && page.messages.length <= 10);
  assert(page.messages.every((m) => m.id && m.createdAt && Array.isArray(m.parts)));
  if (page.hasMore) {
    const older = sessionMessages(sample.id, { limit: 10, cursor: page.nextCursor });
    assert(older.messages.every((m) => !page.messages.some((n) => n.id === m.id)));
    assert(Date.parse(older.messages.at(-1).createdAt) <= Date.parse(page.messages[0].createdAt));
  }
  const toc = questionToc(sample.id);
  if (toc.length) {
    const target = toc[0].messageId;
    assert(aroundMessage(sample.id, target).messages.some((m) => m.id === target));
  }
  const search = archiveSearch(sample.id, { scope: 'metadata' });
  assert(search.results.some((r) => r.sessionId === sample.id));
}
console.log(`archive: ${projects.length} projects · ${sessions.length} sessions · PASS`);
