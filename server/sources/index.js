// Registry: conversation sources plug in here. This build ships a single
// source — opencode — so the adapter list is intentionally just one entry.
import * as opencode from './opencode.js';
import { SOURCE_META } from './_shared.js';

export { SOURCE_META };

const ADAPTERS = { opencode };

// Merge every source into one list, newest first. A failing source is skipped
// (with a warning) rather than taking the whole response down.
// Concurrent callers share one in-flight scan (the browser fires
// /api/conversations and /api/search together; both walk the same trees).
let inFlight = null;
export function listConversations() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const results = await Promise.all(
      Object.entries(ADAPTERS).map(async ([name, a]) => {
        try { return await a.list(); }
        catch (e) { console.warn(`[sources] ${name} list failed:`, e.message); return []; }
      })
    );
    const all = results.flat();
    all.sort((a, b) => {
      const ta = a.lastActivity ? Date.parse(a.lastActivity) : a.mtimeMs;
      const tb = b.lastActivity ? Date.parse(b.lastActivity) : b.mtimeMs;
      return (tb || 0) - (ta || 0);
    });
    return all;
  })();
  return inFlight.finally(() => { inFlight = null; });
}

export async function getConversation(sourceName, ref, lastN = 30) {
  const a = ADAPTERS[sourceName];
  if (!a) throw new Error('unknown source');
  return a.detail(ref, lastN);
}
