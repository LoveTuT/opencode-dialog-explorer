import assert from 'node:assert/strict';
import {
  agentHealth, agentProjects, agentRecent, agentSearch, agentShow, agentToc, agentFind, agentResume, agentSessionMeta, SCHEMA_VERSION,
} from '../server/agent.js';

const health = agentHealth();
assert.equal(health.schemaVersion, SCHEMA_VERSION);
assert.equal(health.ok, true);
assert.equal(typeof health.dbPath, 'string');
assert.match(health.serviceUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

const projects = agentProjects({ limit: 3 });
assert(Array.isArray(projects.projects) && projects.projects.length <= 3);
assert(projects.projects.every((p) => p.id && p.deepLink.includes('/projects/')));
assert(projects.projects.every((p) => typeof p.sessionCount === 'number'));

const recent = agentRecent({ limit: 3 });
assert(Array.isArray(recent.sessions) && recent.sessions.length <= 3);
assert(recent.sessions.every((s) => s.id && s.deepLink.includes('/sessions/') && typeof s.messageCount === 'number'));

// validation is reused from the archive core
assert.throws(() => agentShow({ id: 'not-a-session' }), /invalid session id/);
assert.throws(() => agentToc('ses_../../etc'), /invalid session id/);
assert.throws(() => agentFind('bad id', 'x'), /invalid session id/);
assert.throws(() => agentResume('nope'), /invalid session id/);

if (recent.sessions.length) {
  const id = recent.sessions[0].id;

  const meta = agentSessionMeta(id);
  assert.equal(meta.session.id, id);
  assert(meta.session.deepLink.includes(id));

  const resume = agentResume(id);
  assert(/^opencode /.test(resume.command));
  assert.equal(resume.id, id);

  const show = agentShow({ id, limit: 5, maxChars: 800 });
  assert.equal(show.session.id, id);
  assert(show.messages.every((m) => m.id && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string'));
  const totalChars = show.messages.reduce((n, m) => n + m.text.length, 0);
  assert(totalChars <= 800, `char budget exceeded: ${totalChars}`);

  const toc = agentToc(id);
  assert(toc.items.every((t) => t.messageId && t.deepLink.includes(id) && typeof t.seq === 'number'));

  if (toc.items.length) {
    const term = (toc.items[0].preview || '').slice(0, 4);
    if (term) {
      const found = agentFind(id, term);
      assert(found.hits.every((h) => h.messageId && h.deepLink.includes('message=')));
    }
  }

  const search = agentSearch('e', { scope: 'content', limit: 5 });
  assert(search.hits.every((h) => h.sessionId && h.deepLink.includes('/all/sessions/')));
  if (search.hits.some((h) => h.messageId)) {
    assert(search.hits.filter((h) => h.messageId).every((h) => h.deepLink.includes('message=')));
  }
} else {
  console.log('note: no local sessions — agent data checks skipped');
}

console.log('agent: contract, deep links, validation, char budget · PASS');
