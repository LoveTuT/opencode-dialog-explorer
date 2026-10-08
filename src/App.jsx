import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SORT_OPTIONS, sortConvos } from './sortConvos.js';
import './sort.css';

// Fallback source metadata; replaced by /api/sources on load.
const DEFAULT_META = {
  opencode: { label: 'opencode', short: 'opencode', color: '#f0883e' },
};

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 5) return 'just now'; // also guards small clock/timezone skew
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function CopyButton({ text, label = 'Copy resume command' }) {
  const [copied, setCopied] = useState(false);
  const onClick = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={onClick} title={text}>
      {copied ? '✓ Copied' : label}
    </button>
  );
}

function SourceBadge({ source, meta }) {
  const m = meta[source] || { short: source, color: '#8b949e' };
  return (
    <span className="badge source" style={{ color: m.color, borderColor: m.color }}>
      <span className="dot" style={{ background: m.color }} />
      {m.short}
    </span>
  );
}

// Opens the conversation's project folder in the OS default file manager.
function OpenButton({ path }) {
  const [state, setState] = useState(''); // '' | 'ok' | 'err'
  if (!path) return null;
  const onClick = async (e) => {
    e.stopPropagation(); // don't toggle the card
    try {
      const r = await fetch('/api/open?path=' + encodeURIComponent(path));
      setState(r.ok ? 'ok' : 'err');
    } catch { setState('err'); }
    setTimeout(() => setState(''), 1400);
  };
  return (
    <button className={`srt-open-btn ${state}`} onClick={onClick} title={`Open ${path}`}>
      {state === 'ok' ? '✓ Opened' : state === 'err' ? '✗ Failed' : 'Open'}
    </button>
  );
}

// Wrap every case-insensitive occurrence of any query term in <mark>.
function highlight(text, query) {
  if (!query || !text) return text;
  const s = String(text);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return text;
  const lower = s.toLowerCase();
  const out = [];
  let i = 0;
  while (i < s.length) {
    let best = -1, bestLen = 0;
    for (const t of terms) {
      const p = lower.indexOf(t, i);
      if (p !== -1 && (best === -1 || p < best)) { best = p; bestLen = t.length; }
    }
    if (best === -1) { out.push(s.slice(i)); break; }
    if (best > i) out.push(s.slice(i, best));
    out.push(<mark className="hl" key={best}>{s.slice(best, best + bestLen)}</mark>);
    i = best + bestLen;
  }
  return out;
}

function StarButton({ on, onToggle }) {
  return (
    <button
      className={`star-btn ${on ? 'on' : ''}`}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={on ? 'Unstar' : 'Star'}
      aria-label={on ? 'Unstar' : 'Star'}
      aria-pressed={on}
    >
      {on ? '★' : '☆'}
    </button>
  );
}

// Adapters flatten tool calls / results / thinking into marker lines
// (🔧 / ↳ / 💭). Split them back out so each kind gets its own styling
// instead of one undifferentiated text blob.
function segmentText(text) {
  const segs = [];
  for (const line of String(text).split('\n')) {
    let kind = 'text';
    if (line.startsWith('🔧 ')) kind = 'call';
    else if (line.startsWith('↳ ')) kind = 'result';
    else if (line.startsWith('💭 ')) kind = 'think';
    const last = segs[segs.length - 1];
    if (last && last.kind === kind) last.lines.push(line);
    else segs.push({ kind, lines: [line] });
  }
  return segs;
}

const Message = memo(function Message({ msg, assistantLabel }) {
  const roleClass =
    msg.role === 'user' ? 'm-user' : msg.role === 'tool' ? 'm-tool' : 'm-assistant';
  const roleLabel =
    msg.role === 'user' ? 'User' : msg.role === 'tool' ? 'Tool result' : assistantLabel;
  const segs = useMemo(() => (msg.text ? segmentText(msg.text) : []), [msg.text]);
  return (
    <div className={`msg ${roleClass}`}>
      <div className="msg-role">{roleLabel}</div>
      <div className="msg-text">
        {segs.length === 0 && <span className="muted">(empty)</span>}
        {segs.map((s, i) =>
          s.kind === 'text' ? (
            <span key={i}>{s.lines.join('\n') + '\n'}</span>
          ) : (
            <span key={i} className={`seg seg-${s.kind}`}>{s.lines.join('\n') + '\n'}</span>
          )
        )}
      </div>
    </div>
  );
});

const ConversationCard = memo(function ConversationCard({
  convo, meta, expanded, onToggle, query, starred, onToggleStar, snippet, tick,
}) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const assistantLabel = (meta[convo.source] && meta[convo.source].short) || 'Assistant';
  void tick; // re-renders keep relative timestamps fresh

  useEffect(() => {
    if (expanded && !detail && !loading) {
      setLoading(true);
      const qs = `source=${encodeURIComponent(convo.source)}&ref=${encodeURIComponent(convo.ref)}`;
      fetch(`/api/conversation?${qs}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => setDetail(d.error ? { messages: [], error: true } : d))
        .catch(() => setDetail({ messages: [], error: true }))
        .finally(() => setLoading(false));
    }
  }, [expanded, detail, loading, convo.source, convo.ref]);

  return (
    <div className={`card ${expanded ? 'expanded' : ''}`}>
      <div
        className="card-head"
        onClick={() => onToggle(convo.key)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(convo.key); }
        }}
      >
        <div className="card-main">
          <div className="card-title">{highlight(convo.title, query)}</div>
          <div className="card-meta">
            <SourceBadge source={convo.source} meta={meta} />
            <span className="badge project">{highlight(convo.projectLabel, query)}</span>
            {convo.gitBranch && <span className="badge branch">⎇ {convo.gitBranch}</span>}
            <span className="badge">{convo.messageCount} msgs</span>
            <span className="badge time">{relativeTime(convo.lastActivity)}</span>
          </div>
          <div className="card-path">{highlight(convo.projectPath, query)}</div>
          {snippet && (
            <div className="card-snippet" title="matched in conversation content">
              💬 {highlight(snippet, query)}
            </div>
          )}
        </div>
        <div className="card-actions">
          <StarButton on={starred} onToggle={() => onToggleStar(convo.key)} />
          <CopyButton text={convo.resume} />
          <OpenButton path={convo.projectPath} />
          <span className="chevron">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="card-body">
          <div className="resume-line">
            <code>{convo.resume}</code>
          </div>
          {loading && <div className="muted pad">Loading last 30 messages…</div>}
          {detail && detail.error && (
            <div className="error pad">
              Failed to load messages.{' '}
              <button className="retry-btn" onClick={() => setDetail(null)}>Retry</button>
            </div>
          )}
          {detail && !detail.error && detail.messages && detail.messages.length === 0 && (
            <div className="muted pad">No messages.</div>
          )}
          {detail &&
            detail.messages &&
            detail.messages.map((m, i) => (
              <Message key={i} msg={m} assistantLabel={assistantLabel} />
            ))}
        </div>
      )}
    </div>
  );
});

// localStorage namespace for this app's own view state.
const NS = 'ocde';

// Filters persist across refreshes via localStorage.
const FILTERS_KEY = `${NS}.filters`;
function loadFilters() {
  try { return JSON.parse(localStorage.getItem(FILTERS_KEY)) || {}; } catch { return {}; }
}

// Starred conversation keys persist separately.
const STARRED_KEY = `${NS}.starred`;
function loadStarred() {
  try { return JSON.parse(localStorage.getItem(STARRED_KEY)) || []; } catch { return []; }
}

export default function App() {
  const saved = loadFilters();
  const [convos, setConvos] = useState(null);
  const [meta, setMeta] = useState(DEFAULT_META);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState(saved.query || '');
  const [project, setProject] = useState(saved.project || 'all');
  const [sort, setSort] = useState(saved.sort || 'recent');
  const [starredOnly, setStarredOnly] = useState(saved.starredOnly ?? false);
  const [starred, setStarred] = useState(() => new Set(loadStarred()));
  const [expandedKey, setExpandedKey] = useState(null);
  const searchRef = useRef(null);
  const [showTop, setShowTop] = useState(false);
  const [contentKeys, setContentKeys] = useState(() => new Set());
  const [contentSnippets, setContentSnippets] = useState({});
  const [searching, setSearching] = useState(false);

  // Debounced full-content search: greps transcript bodies server-side and
  // unions the matches into the (instant, metadata) filter below.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setContentKeys(new Set()); setContentSnippets({}); setSearching(false); return; }
    setSearching(true);
    const id = setTimeout(() => {
      fetch('/api/search?q=' + encodeURIComponent(q))
        .then((r) => r.json())
        .then((d) => { setContentKeys(new Set(d.keys || [])); setContentSnippets(d.snippets || {}); })
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  const toggleStar = useCallback((key) => setStarred((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    try { localStorage.setItem(STARRED_KEY, JSON.stringify([...next])); } catch {}
    return next;
  }), []);

  const toggleExpand = useCallback(
    (key) => setExpandedKey((prev) => (prev === key ? null : key)),
    []
  );

  // Save filters (and view prefs) whenever they change.
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify({ query, project, sort, starredOnly }));
    } catch {}
  }, [query, project, sort, starredOnly]);

  // Load + refresh. Refreshes happen silently in the background (the list is
  // replaced in place); the initial load shows skeletons.
  const [refreshing, setRefreshing] = useState(false);
  const lastLoadRef = useRef(0);
  const loadConversations = useCallback((silent = false) => {
    if (!silent) setError(null);
    setRefreshing(true);
    return fetch('/api/conversations')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setConvos(d);
        setError(null);
        lastLoadRef.current = Date.now();
      })
      .catch((e) => { if (!silent) setError(String(e.message || e)); })
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    fetch('/api/sources').then((r) => r.json()).then(setMeta).catch(() => {});
    loadConversations();
  }, [loadConversations]);

  // Refresh when the tab regains focus (if the data is older than 30s), so new
  // conversations show up without a manual reload.
  useEffect(() => {
    const onFocus = () => {
      if (document.hidden) return;
      if (Date.now() - lastLoadRef.current > 30000) loadConversations(true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [loadConversations]);

  // Minute tick keeps the relative "Xm ago" badges from going stale.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // Drop a persisted filter that no longer matches any data (e.g. a project
  // that disappeared) so the user never lands on a confusing empty list.
  useEffect(() => {
    if (!convos) return;
    if (project !== 'all' && !convos.some((c) => c.projectLabel === project)) setProject('all');
  }, [convos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: "/" or ⌘/Ctrl-K focuses search; Esc clears it.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Show a back-to-top button once scrolled down (the list can get very long).
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 800);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const starredCount = useMemo(
    () => (convos ? convos.reduce((n, c) => n + (starred.has(c.key) ? 1 : 0), 0) : 0),
    [convos, starred]
  );

  // Projects present in the data.
  const projects = useMemo(() => {
    if (!convos) return [];
    const counts = new Map();
    for (const c of convos) {
      counts.set(c.projectLabel, (counts.get(c.projectLabel) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [convos]);

  const filtered = useMemo(() => {
    if (!convos) return [];
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return convos.filter((c) => {
      if (starredOnly && !starred.has(c.key)) return false;
      if (project !== 'all' && c.projectLabel !== project) return false;
      if (!terms.length) return true;
      const sm = meta[c.source] || {};
      const hay = `${c.title} ${c.projectLabel} ${c.projectPath || ''} ${c.firstUserText || ''} ${c.id} ${c.source} ${sm.label || ''}`.toLowerCase();
      // metadata: every term must match (AND); content: server-side match union.
      return terms.every((t) => hay.includes(t)) || contentKeys.has(c.key);
    });
  }, [convos, query, project, meta, starredOnly, starred, contentKeys]);

  const sorted = useMemo(() => sortConvos(filtered, sort), [filtered, sort]);

  // Incremental rendering: only mount the first `limit` cards (2000+ DOM nodes
  // is slow). An IntersectionObserver grows the limit as you scroll near the
  // bottom; it resets whenever the filter/sort result changes.
  const PAGE = 80;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [query, project, sort]);
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setLimit((l) => (l < sorted.length ? l + PAGE : l)); },
      { rootMargin: '800px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [sorted.length, limit]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="title-row">
          <h1>opencode Dialog Explorer</h1>
          <span className="count">
            {convos ? `${filtered.length} / ${convos.length}` : '…'}
            {searching && <span className="searching"> · searching content…</span>}
          </span>
          <div className="header-actions">
            <button
              className={`stats-toggle refresh-btn ${refreshing ? 'spinning' : ''}`}
              onClick={() => loadConversations(true)}
              disabled={refreshing}
              title="Refresh conversations"
              aria-label="Refresh conversations"
            >
              ⟳
            </button>
          </div>
        </div>

        {convos && (
          <div className="source-filter">
            <button
              className={`chip star-chip ${starredOnly ? 'active' : ''}`}
              onClick={() => setStarredOnly((v) => !v)}
              title="Show only starred"
            >
              ★ Starred <span className="chip-n">{starredCount}</span>
            </button>
          </div>
        )}

        <div className="controls">
          <div className="search-wrap">
            <input
              ref={searchRef}
              className="search"
              placeholder="Search title, project, path, first message…  ( / )"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button
                className="search-clear"
                onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                title="Clear (Esc)"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="all">All projects ({projects.reduce((a, [, n]) => a + n, 0)})</option>
            {projects.map(([name, n]) => (
              <option key={name} value={name}>
                {name} ({n})
              </option>
            ))}
          </select>
          <select className="srt-select" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </header>

      <main className="list">
        {error && (
          <div className="error pad">
            Failed to load: {error}{' '}
            <button className="retry-btn" onClick={() => loadConversations()}>Retry</button>
          </div>
        )}
        {!convos && !error && (
          <div className="skeletons" aria-label="Loading conversations">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="card skeleton" key={i}>
                <div className="sk-line sk-title" />
                <div className="sk-line sk-meta" />
                <div className="sk-line sk-path" />
              </div>
            ))}
          </div>
        )}
        {convos && filtered.length === 0 && (
          <div className="muted pad">
            No conversations match.
            {(query || project !== 'all' || starredOnly) && (
              <>
                {' '}
                <button
                  className="retry-btn"
                  onClick={() => { setQuery(''); setProject('all'); setStarredOnly(false); }}
                >
                  Clear filters
                </button>
              </>
            )}
          </div>
        )}
        {sorted.slice(0, limit).map((c) => (
          <ConversationCard
            key={c.key}
            convo={c}
            meta={meta}
            query={query.trim()}
            snippet={contentSnippets[c.key]}
            starred={starred.has(c.key)}
            onToggleStar={toggleStar}
            expanded={expandedKey === c.key}
            onToggle={toggleExpand}
            tick={tick}
          />
        ))}
        {sorted.length > limit && (
          <button
            ref={sentinelRef}
            className="load-more"
            onClick={() => setLimit((l) => l + PAGE)}
          >
            Show {Math.min(PAGE, sorted.length - limit)} more
            <span className="muted"> · {limit} of {sorted.length} shown</span>
          </button>
        )}
      </main>

      {showTop && (
        <button
          className="to-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          title="Back to top"
          aria-label="Back to top"
        >
          ↑
        </button>
      )}
    </div>
  );
}
