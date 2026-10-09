// Smoke test: validates the archive data contract against the real local data.
// Run with `npm test`. Exits non-zero on any failure.
import { archiveIndex, projectSessions, sessionMessages, questionToc, aroundMessage, archiveSearch } from '../server/archive.js';
import { openPath } from '../server/open.js';

let pass = 0;
const fails = [];
const check = (name, cond) => { cond ? pass++ : fails.push(name); };
const acheck = async (name, fn) => { try { await fn(); pass++; } catch (e) { fails.push(`${name}: ${e.message}`); } };

const t0 = Date.now();

const { projects, sessions } = archiveIndex();
check('projects is an array', Array.isArray(projects));
check('sessions is an array', Array.isArray(sessions));
check('unique project ids', new Set(projects.map((p) => p.id)).size === projects.length);
check('unique session ids', new Set(sessions.map((s) => s.id)).size === sessions.length);
check('every session belongs to a project', sessions.every((s) => projects.some((p) => p.id === s.projectId)));
check('every session identifies its source', sessions.every((s) => s.identitySource === 'project_id' || s.identitySource === 'directory'));
check('every session has messages', sessions.every((s) => s.messageCount > 0));
check('every session has a resume command', sessions.every((s) => /^opencode /.test(s.resume)));
check('sessions expose firstQuestion', sessions.every((s) => typeof s.firstQuestion === 'string'));
check('no future timestamps', sessions.every((s) => !s.lastActivity || Date.parse(s.lastActivity) <= Date.now() + 60000));
check('no empty titles', sessions.every((s) => s.title && String(s.title).trim()));
check('projects pinned-first then by activity', projects.every((p, i) => {
  if (i === 0) return true;
  const prev = projects[i - 1];
  if (!!prev.pinned !== !!p.pinned) return !!prev.pinned && !p.pinned;
  return (prev.lastActivity || '').localeCompare(p.lastActivity || '') >= 0;
}));

if (sessions.length === 0) console.log('note: no local sessions found — data-dependent checks will be skipped');

// ---- security: reject path-traversal / malformed refs ----
const EVIL = ['/etc/passwd', '../../../../etc/passwd', 'ses_../../etc/passwd'];
for (const ref of EVIL) {
  await acheck(`rejects ref ${JSON.stringify(ref)}`, async () => {
    let leaked = false;
    try { await sessionMessages(ref, { limit: 1 }); leaked = true; } catch { /* rejected = good */ }
    if (leaked) throw new Error(`read disallowed ref: ${ref}`);
  });
}

// ---- paging / toc / around ----
if (sessions.length) {
  const sample = sessions.find((s) => s.messageCount > 40) || sessions[0];
  const page = sessionMessages(sample.id, { limit: 10 });
  check('page bounded by limit', page.messages.length > 0 && page.messages.length <= 10);
  check('messages well-formed', page.messages.every((m) => m.id && m.createdAt && Array.isArray(m.parts)));
  if (page.hasMore) {
    const older = sessionMessages(sample.id, { limit: 10, cursor: page.nextCursor });
    check('paging does not overlap', older.messages.every((m) => !page.messages.some((n) => n.id === m.id)));
  }
  const toc = questionToc(sample.id);
  check('toc well-formed', toc.every((t) => t.messageId && t.createdAt && typeof t.preview === 'string'));
  if (toc.length) {
    const target = toc[Math.floor(toc.length / 2)].messageId;
    const around = aroundMessage(sample.id, target, { limit: 9 });
    check('around window contains hit', around.messages.some((m) => m.id === target));
    check('around marks itself as a jump', around.jumped === true);
  }
  const projectPage = projectSessions(sample.projectId, { limit: 3 });
  check('project sessions are paginated', projectPage.sessions.length <= 3 && projectPage.sessions.every((s) => s.projectId === sample.projectId));
  check('project total covers the page', projectPage.total >= projectPage.sessions.length);
}

// ---- search ----
await acheck('search: empty query matches nothing', async () => {
  if (archiveSearch('').total !== 0) throw new Error('empty query should match nothing');
});
await acheck('search: common term matches', async () => {
  const r = archiveSearch('e', { scope: 'content', limit: 5 });
  if (sessions.length && r.total === 0) throw new Error('no content matches');
});
await acheck('search: multi-word AND narrows to 0', async () => {
  if (archiveSearch('e zzqqxxnotarealword').total !== 0) throw new Error('AND did not narrow to 0');
});
await acheck('search: multi-hit returns message anchors', async () => {
  const r = archiveSearch('e', { scope: 'content', limit: 100 });
  if (r.results.some((hit) => !hit.messageId)) throw new Error('content hit missing messageId');
});

// ---- open module (validation only — never opens a real path) ----
const rejects = (p) => { try { openPath(p); return false; } catch { return true; } };
check('openPath rejects nonexistent path', rejects('/definitely/not/real/xyz-123'));
check('openPath rejects empty path', rejects(''));
check('openPath rejects null', rejects(null));

// ---- report ----
const ms = Date.now() - t0;
console.log(`\nprojects: ${projects.length} · sessions: ${sessions.length} · ${ms}ms`);
console.log(`PASS ${pass}  FAIL ${fails.length}`);
if (fails.length) {
  console.log('FAILURES:\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('✓ all checks passed');
