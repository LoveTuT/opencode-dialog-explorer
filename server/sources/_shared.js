// Helpers for the opencode conversation source adapter.

// Metadata for the supported tool: display name and accent colour (used by
// the UI for the source badge and the assistant role label).
export const SOURCE_META = {
  opencode: { label: 'opencode', short: 'opencode', color: '#f0883e' },
};

export function clip(str, n = 300) {
  if (typeof str !== 'string') {
    try { str = JSON.stringify(str); } catch { str = String(str); }
  }
  return str.length > n ? str.slice(0, n) + '…' : str;
}

export function toolUseLine(name, input) {
  let s = '';
  if (input != null) {
    try { s = typeof input === 'string' ? input : JSON.stringify(input); } catch { s = ''; }
  }
  return `🔧 ${name || 'tool'}(${clip(s, 300)})`;
}

export function toolResultLine(text) {
  return '↳ ' + clip(typeof text === 'string' ? text : JSON.stringify(text ?? ''), 600);
}

export function thinkingLine(text) {
  return '💭 ' + text;
}

// The card title shown for a project: the last meaningful path segment of cwd.
export function projectLabel(cwd) {
  if (!cwd) return '(unknown)';
  const parts = cwd.split('/').filter(Boolean);
  let leaf = parts[parts.length - 1] || cwd;
  return leaf;
}

// Build a normalised list entry.
export function makeEntry({
  source, id, ref, title, cwd, gitBranch,
  userCount = 0, assistantCount = 0, messageCount, lastActivity, mtimeMs, firstUserText = '', resume,
}) {
  return {
    source,
    id,
    ref,
    // key must be globally unique for React lists; `ref` is unique per
    // conversation whereas `id` can collide.
    key: `${source}:${ref}`,
    title: title || (firstUserText ? firstUserText.slice(0, 80) : '(untitled)'),
    projectLabel: projectLabel(cwd),
    projectPath: cwd || '',
    gitBranch: gitBranch || null,
    messageCount: messageCount != null ? messageCount : userCount + assistantCount,
    lastActivity: lastActivity || null,
    mtimeMs: mtimeMs || 0,
    firstUserText: (firstUserText || '').slice(0, 200),
    resume: resume || '',
  };
}

// Pass the project directly to OpenCode so Windows need not switch drives with `cd`.
export function resumeCommand(cwd, id, platform = process.platform) {
  if (!cwd) return `opencode --session ${id}`;
  if (platform === 'win32') return `opencode '${cwd.replaceAll("'", "''")}' --session ${id}`;
  return `opencode '${cwd.replaceAll("'", "'\\''")}' --session ${id}`;
}
