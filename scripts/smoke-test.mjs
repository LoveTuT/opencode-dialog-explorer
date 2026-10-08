// Smoke test: exercises the opencode source adapter + the open/search modules
// against the real local data, validating the API data contract. Run with
// `npm test`. Exits non-zero on any failure.
import { listConversations, getConversation, SOURCE_META } from '../server/sources/index.js';
import { openPath } from '../server/open.js';
import { searchContent } from '../server/search.js';

let pass = 0;
const fails = [];
const check = (name, cond) => { cond ? pass++ : fails.push(name); };
const acheck = async (name, fn) => { try { await fn(); pass++; } catch (e) { fails.push(`${name}: ${e.message}`); } };

const t0 = Date.now();

// ---- list contract ----
const all = await listConversations();
check('list returns array', Array.isArray(all));
// An empty list is valid on a machine with no AI-CLI data yet — the
// data-dependent checks below all iterate over what's actually present.
if (all.length === 0) {
  console.log('note: no local conversations found — data-dependent checks will be skipped');
}

const REQUIRED = ['source', 'key', 'ref', 'title', 'projectPath', 'resume', 'lastActivity'];
const keys = new Set();
let dupes = 0, missing = 0, badCount = 0, future = 0, emptyTitle = 0;
const now = Date.now();
for (const c of all) {
  if (keys.has(c.key)) dupes++;
  keys.add(c.key);
  for (const f of REQUIRED) if (c[f] == null) missing++;
  if (!Number.isFinite(c.messageCount)) badCount++;
  if (c.lastActivity && Date.parse(c.lastActivity) > now + 60000) future++;
  if (!c.title || !String(c.title).trim()) emptyTitle++;
}
check('unique keys', dupes === 0);
check('no missing required fields', missing === 0);
check('messageCount always finite', badCount === 0);
check('no future timestamps', future === 0);
check('no empty titles', emptyTitle === 0);
check('list sorted newest-first', all.every((c, i) =>
  i === 0 || (Date.parse(all[i - 1].lastActivity) || 0) >= (Date.parse(c.lastActivity) || 0)));

// ---- per-source detail ----
const bySource = {};
for (const c of all) (bySource[c.source] ??= []).push(c);
for (const [src, list] of Object.entries(bySource)) {
  check(`SOURCE_META defines ${src}`, !!SOURCE_META[src]);
  await acheck(`detail[${src}]`, async () => {
    const d = await getConversation(src, list[0].ref, 10);
    if (!d || !Array.isArray(d.messages)) throw new Error('messages not an array');
    if (!d.resume) throw new Error('missing resume command');
    if (d.messages.some((m) => !['user', 'assistant', 'tool'].includes(m.role)))
      throw new Error('unexpected message role');
  });
}

// ---- security: every adapter must reject path-traversal refs ----
const EVIL = ['/etc/passwd', '../../../../etc/passwd', 'ses_../../etc/passwd'];
for (const src of Object.keys(bySource)) {
  await acheck(`security[${src}] rejects traversal`, async () => {
    for (const ref of EVIL) {
      let leaked = false;
      try { await getConversation(src, ref, 1); leaked = true; } catch { /* rejected = good */ }
      if (leaked) throw new Error(`read disallowed ref: ${ref}`);
    }
  });
}

// ---- content search ----
await acheck('content search builds index + matches', async () => {
  const empty = await searchContent('');
  if (empty.keys.length !== 0) throw new Error('empty query should match nothing');
  const common = await searchContent('e'); // every English transcript contains "e"
  if (all.length > 0 && !(common.keys.length > 0)) throw new Error('index empty / no content matches');
  const narrowed = await searchContent('e zzqqxxnotarealword');
  if (narrowed.keys.length !== 0) throw new Error('multi-word AND did not narrow to 0');
});

// ---- open module (validation only — never opens a real path) ----
const rejects = (p) => { try { openPath(p); return false; } catch { return true; } };
check('openPath rejects nonexistent path', rejects('/definitely/not/real/xyz-123'));
check('openPath rejects empty path', rejects(''));
check('openPath rejects null', rejects(null));

// ---- report ----
const ms = Date.now() - t0;
console.log(`\nsources: ${Object.keys(bySource).length}/${Object.keys(SOURCE_META).length} with data · conversations: ${all.length} · ${ms}ms`);
console.log(`PASS ${pass}  FAIL ${fails.length}`);
if (fails.length) {
  console.log('FAILURES:\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('✓ all checks passed');
