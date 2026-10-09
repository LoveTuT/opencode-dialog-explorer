import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, Reorder, useReducedMotion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeFindHighlight from './rehypeFindHighlight.js';
import { moveId } from './reorder.js';

// Optimistic custom order for the pinned subset. `items` is the server-ordered
// list; `persist(ids)` stores the new order and must reject on failure so we can
// roll back. The local order resets only when the *set* of pinned ids changes
// (pin toggled, filter changed, page replaced) — not on order-only changes,
// because the source list (e.g. the project page) is not refetched after we
// persist, so trusting its stale order would undo our optimistic move.
function usePinnedOrder(items, persist, onError) {
  const serverIds = items.map((item) => item.id);
  const setSig = serverIds.slice().sort().join('\u0000');
  const [order, setOrder] = useState(serverIds);
  const [saving, setSaving] = useState(false);
  const setSigRef = useRef(setSig);
  const orderRef = useRef(order);
  const savingRef = useRef(false);
  const dragStartRef = useRef(null);
  const didDragRef = useRef(false);
  const downRef = useRef(null);
  const scope = setSig;
  orderRef.current = order;
  useEffect(() => {
    if (setSigRef.current !== setSig) {
      setSigRef.current = setSig;
      dragStartRef.current = null;
      didDragRef.current = false;
      orderRef.current = serverIds;
      setOrder(serverIds);
    }
    // serverIds is the current server order for this set; setSig guards the update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSig]);
  const commit = (nextIds, prev = orderRef.current) => {
    if (savingRef.current || !Array.isArray(nextIds) || nextIds.length !== orderRef.current.length) return;
    if (nextIds.join('\u0000') === prev.join('\u0000')) return;
    savingRef.current = true;
    setSaving(true);
    orderRef.current = nextIds;
    setOrder(nextIds);
    Promise.resolve().then(() => persist(nextIds)).catch((e) => {
      if (setSigRef.current === scope) {
        orderRef.current = prev;
        setOrder(prev);
      }
      onError?.(e);
    }).finally(() => {
      savingRef.current = false;
      setSaving(false);
    });
  };
  const preview = (nextIds) => {
    if (savingRef.current) return;
    if (nextIds.join('\u0000') !== orderRef.current.join('\u0000')) didDragRef.current = true;
    orderRef.current = nextIds;
    setOrder(nextIds);
  };
  const beginDrag = () => {
    dragStartRef.current = orderRef.current;
    didDragRef.current = false;
  };
  const finishDrag = () => {
    if (didDragRef.current && dragStartRef.current) commit(orderRef.current, dragStartRef.current);
    dragStartRef.current = null;
    didDragRef.current = false;
  };
  // Remember where a press began so the following click can tell a drag from a tap.
  const beginPointer = (e) => { downRef.current = { el: e.currentTarget, x: e.clientX, y: e.clientY, t: Date.now() }; };
  // True when the click landed far from where the press began (i.e. a drag) on the
  // same control, so the caller must not navigate. Independent of Motion's drag
  // callbacks and their ordering.
  const guardRowClick = (e) => {
    const start = downRef.current;
    downRef.current = null;
    if (!start || start.el !== e.currentTarget) return false;
    if (Date.now() - start.t > 700) return false;
    return Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6;
  };
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = order.map((id) => byId.get(id)).filter(Boolean);
  return [ordered, commit, preview, beginDrag, finishDrag, beginPointer, guardRowClick, saving];
}

const endpoint = (path) => '/api/archive/' + path;
async function request(path, options) {
  const response = await fetch(endpoint(path), options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
const age = (date) => {
  if (!date) return '—';
  const days = Math.floor((Date.now() - Date.parse(date)) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  return new Date(date).toLocaleDateString('zh-CN');
};
const short = (text, max = 100) => text?.length > max ? `${text.slice(0, max)}…` : text || '';
const matchLabel = { title: '标题', project: '项目', path: '路径', tags: '标签', note: '备注', id: '会话 ID', content: '正文' };
const SCOPES = [['all', '全部'], ['metadata', '标题与路径'], ['content', '正文']];
function Highlight({ text, query }) {
  const value = String(text || '');
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!terms.length) return value;
  const pattern = new RegExp(terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  const nodes = [];
  let from = 0;
  for (const match of value.matchAll(pattern)) {
    if (match.index > from) nodes.push(value.slice(from, match.index));
    nodes.push(<mark className="search-match" key={match.index}>{match[0]}</mark>);
    from = match.index + match[0].length;
  }
  if (from < value.length) nodes.push(value.slice(from));
  return nodes.length ? nodes : value;
}
const projectName = (project) => project?.alias || project?.name || '未命名项目';
const current = () => location.pathname + location.search;

function Icon({ name }) {
  const shapes = {
    folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></>,
    pin: <><path d="m8 3 8 0-1 6 3 3v2H6v-2l3-3zM12 14v7" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" /></>,
    chevron: <><path d="m9 5 7 7-7 7" /></>,
    back: <><path d="m15 5-7 7 7 7" /></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

function Part({ part, findTerm }) {
  if (part.type === 'tool') return <details className="process"><summary>工具 · {part.name}</summary><pre>{JSON.stringify(part.input ?? {}, null, 2)}</pre>{part.output && <pre>{String(part.output)}</pre>}</details>;
  if (part.type === 'reasoning') return <details className="process"><summary>思考过程</summary><pre>{part.text}</pre></details>;
  if (part.type === 'file') return <div className="attachment">附件记录 · {part.text}</div>;
  return <div className="message-text"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={findTerm ? [[rehypeFindHighlight, findTerm]] : []} skipHtml components={{ a: ({ children, href }) => <a href={/^https?:\/\//.test(href || '') ? href : undefined} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span className="attachment">图片记录 · {alt || '未命名'}</span>, code: ({ children, className }) => <code className={className}>{children}</code> }}>{part.text}</ReactMarkdown></div>;
}

function CopyButton({ value, label, onNotify, className }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onNotify(label === '复制恢复命令' ? '恢复命令已复制' : 'Session ID 已复制');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      onNotify('复制失败，请检查剪贴板权限', true);
    }
  };
  return <button className={`${className || ''}${copied ? ' copied' : ''}`} onClick={copy}>{copied ? '✓ 已复制' : label}</button>;
}

function ActionHint({ text, children }) {
  const [position, setPosition] = useState(null);
  const hintRef = useRef(null);
  const show = (element) => {
    const rect = element.getBoundingClientRect();
    setPosition({ top: rect.bottom + 10, center: rect.left + rect.width / 2 });
  };
  useLayoutEffect(() => {
    if (!position || !hintRef.current) return;
    const hint = hintRef.current;
    const width = hint.getBoundingClientRect().width;
    const left = Math.max(12, Math.min(position.center - width / 2, window.innerWidth - width - 12));
    hint.style.left = `${left}px`;
    hint.style.setProperty('--arrow-left', `${position.center - left - 5}px`);
  }, [position, text]);
  return <span className="action-hint" onMouseEnter={(event) => show(event.currentTarget)} onMouseLeave={() => setPosition(null)} onFocus={(event) => show(event.currentTarget)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPosition(null); }} onKeyDown={(event) => { if (event.key === 'Escape') setPosition(null); }} onClick={() => setPosition(null)}>
    {children}
    {position && createPortal(<div ref={hintRef} className="question-key-preview action-hint-preview" style={{ top: position.top, left: 0 }} role="tooltip"><p>{text}</p></div>, document.body)}
  </span>;
}

function QuestionKeys({ items, activeId, onLocate }) {
  const [preview, setPreview] = useState(null);
  const [touch, setTouch] = useState(false);
  const touchRef = useRef(false);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const [height, setHeight] = useState(window.innerHeight);
  const [range, setRange] = useState({ first: 1, last: items.length, hasBefore: false, hasAfter: false });
  const keysRef = useRef(null);
  useEffect(() => {
    const resize = () => setHeight(window.innerHeight);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const updateRange = () => {
    const scroll = keysRef.current;
    if (!scroll) return;
    const buttons = scroll.querySelectorAll('.question-key');
    const top = scroll.getBoundingClientRect().top;
    const bottom = scroll.getBoundingClientRect().bottom;
    let first = 0;
    let last = 0;
    buttons.forEach((button, index) => {
      const rect = button.getBoundingClientRect();
      if (rect.bottom > top && rect.top < bottom) {
        if (!first) first = index + 1;
        last = index + 1;
      }
    });
    setRange({ first, last, hasBefore: scroll.scrollTop > 1, hasAfter: scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 1 });
  };
  useEffect(() => {
    updateRange();
    const observer = new ResizeObserver(updateRange);
    if (keysRef.current) observer.observe(keysRef.current);
    return () => observer.disconnect();
  }, [items, height]);
  useEffect(() => {
    if (!activeId || !keysRef.current) return;
    const key = [...keysRef.current.querySelectorAll('.question-key')].find((button) => button.dataset.messageId === activeId);
    if (key && !keysRef.current.contains(document.activeElement)) {
      const scroll = keysRef.current;
      const keyRect = key.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      if (keyRect.top < scrollRect.top || keyRect.bottom > scrollRect.bottom) {
        scroll.scrollTo({ top: scroll.scrollTop + keyRect.top - scrollRect.top - scroll.clientHeight / 2, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      }
    }
  }, [activeId]);
  const keyHeight = Math.max(15, Math.min(23, Math.floor((Math.min(height * .58, 460) - 80) / Math.max(items.length, 1)) - 4));
  const show = (item, element) => {
    const bounds = element.getBoundingClientRect();
    const top = Math.max(12, Math.min(bounds.top - 22, window.innerHeight - 190));
    setPosition({ top, right: window.innerWidth - bounds.left + 12, '--arrow-top': `${Math.max(12, bounds.top - top + bounds.height / 2 - 5)}px` });
    setPreview(item);
  };
  const go = (item) => { setPreview(null); onLocate(item.messageId); };
  return <aside className="question-keys" aria-label={`本会话目录，${items.length} 个提问`} style={{ '--key-height': `${keyHeight}px` }} onMouseLeave={() => { if (!touch) setPreview(null); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !event.relatedTarget?.closest('.question-key-preview')) setPreview(null); }} onKeyDown={(event) => { if (event.key === 'Escape') setPreview(null); }}>
    <div className="question-keys-heading" aria-hidden="true">提问 <span>{items.length}</span></div>
    <button type="button" className="question-keys-step" disabled={!range.hasBefore} aria-label="向上浏览提问" onClick={() => keysRef.current?.scrollBy({ top: -keysRef.current.clientHeight * .8, behavior: 'smooth' })}>⌃</button>
    <div className="question-keys-scroll" ref={keysRef} onScroll={updateRange}>
      {items.map((item) => <button key={item.messageId} data-message-id={item.messageId} type="button" className={`question-key ${activeId === item.messageId ? 'is-current' : ''} ${preview?.messageId === item.messageId ? 'is-previewed' : ''}`}
        aria-label={`第 ${item.seq} 个提问：${item.preview}`} aria-current={activeId === item.messageId ? 'location' : undefined}
        onMouseEnter={(event) => { if (event.nativeEvent.sourceCapabilities?.firesTouchEvents !== true) { touchRef.current = false; setTouch(false); show(item, event.currentTarget); } }}
        onFocus={(event) => { if (!touchRef.current) show(item, event.currentTarget); }}
        onClick={(event) => { if (event.detail === 0) { go(item); return; } if (touchRef.current) { if (preview?.messageId === item.messageId) go(item); else show(item, event.currentTarget); } else go(item); }}
        onTouchStart={() => { touchRef.current = true; setTouch(true); }}><span>{String(item.seq).padStart(2, '0')}</span></button>)}
    </div>
    <button type="button" className="question-keys-step" disabled={!range.hasAfter} aria-label="向下浏览提问" onClick={() => keysRef.current?.scrollBy({ top: keysRef.current.clientHeight * .8, behavior: 'smooth' })}>⌄</button>
    <span className="question-keys-range" aria-live="off">{range.first}–{range.last}<br />/{items.length}</span>
    {preview && createPortal(<div className={`question-key-preview${touch ? ' is-touch' : ''}`} style={position} role="status">
      <div className="question-key-meta"><span>提问 {String(preview.seq).padStart(2, '0')}</span><time>{new Date(preview.createdAt).toLocaleString('zh-CN')}</time></div>
      <p>{preview.preview}</p>
      {touch && <button type="button" onClick={() => go(preview)}>跳转到提问 →</button>}
    </div>, document.body)}
  </aside>;
}

function Reader({ id, jump, onBack, onNotify, session, onRename, onMeta, questionsOnly, onQuestionsOnlyChange }) {
  const [detail, setDetail] = useState(null);
  const [toc, setToc] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tocOpen, setTocOpen] = useState(true);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findHits, setFindHits] = useState([]);
  const [findIndex, setFindIndex] = useState(0);
  const [findBusy, setFindBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const scroller = useRef(null);
  const pendingAnchor = useRef(null);
  const pendingTop = useRef(false);
  const prependAnchor = useRef(null);
  const requestVersion = useRef(0);
  const jumpHandled = useRef(null);
  const currentId = useRef(id);
  currentId.current = id;
  useEffect(() => {
    let live = true;
    requestVersion.current++;
    pendingAnchor.current = null;
    pendingTop.current = false;
    prependAnchor.current = null;
    jumpHandled.current = null;
    setBusy(false);
    setDetail(null); setError(''); setToc([]); setActiveQuestion(null);
    setFindOpen(false); setFindQuery(''); setFindHits([]); setFindIndex(0); setFindBusy(false);
    Promise.all([request(`sessions/${encodeURIComponent(id)}`), request(`sessions/${encodeURIComponent(id)}/toc`)]).then(([d, t]) => {
      if (live) { setDetail(d); setToc(t); }
    }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; requestVersion.current++; };
  }, [id]);

  const locate = async (messageId) => {
    if (!messageId) return;
    const version = ++requestVersion.current;
    pendingAnchor.current = null;
    pendingTop.current = false;
    prependAnchor.current = null;
    setBusy(false);
    setActiveQuestion(messageId);
    const anchor = scroller.current?.querySelector(`#message-${CSS.escape(messageId)}`);
    if (!anchor) {
      setBusy(true);
      try {
        const page = await request(`sessions/${encodeURIComponent(id)}/around?messageId=${encodeURIComponent(messageId)}`);
        if (version !== requestVersion.current || id !== currentId.current) return;
        pendingAnchor.current = messageId;
        setDetail((old) => ({ ...old, messages: page.messages, hasMore: page.hasMore, nextCursor: page.nextCursor, jumped: true }));
      } catch (e) { if (version === requestVersion.current && id === currentId.current) setError(e.message); }
      finally { if (version === requestVersion.current && id === currentId.current) setBusy(false); }
    } else anchor.scrollIntoView({ behavior: 'instant', block: 'start' });
  };
  useLayoutEffect(() => {
    if (prependAnchor.current) {
      const { id: anchorId, top } = prependAnchor.current;
      const node = scroller.current?.querySelector(`#message-${CSS.escape(anchorId)}`);
      if (node && top != null) scroller.current.scrollTop += node.getBoundingClientRect().top - top;
      prependAnchor.current = null;
    }
    if (pendingTop.current) {
      scroller.current?.scrollTo({ top: 0, behavior: 'instant' });
      pendingTop.current = false;
    }
    if (!pendingAnchor.current) return;
    const anchor = scroller.current?.querySelector(`#message-${CSS.escape(pendingAnchor.current)}`);
    if (anchor) {
      anchor.scrollIntoView({ behavior: 'instant', block: 'start' });
      pendingAnchor.current = null;
    }
  }, [detail?.messages]);
  useEffect(() => {
    const reader = scroller.current;
    if (!reader || !toc.length) return;
    const update = () => {
      const threshold = reader.getBoundingClientRect().top + 160;
      let nearest = null;
      for (const item of toc) {
        const node = reader.querySelector(`#message-${CSS.escape(item.messageId)}`);
        if (node && node.getBoundingClientRect().top <= threshold) nearest = item.messageId;
      }
      setActiveQuestion(nearest);
    };
    update();
    reader.addEventListener('scroll', update, { passive: true });
    return () => reader.removeEventListener('scroll', update);
  }, [toc, detail?.messages, questionsOnly]);
  useEffect(() => {
    if (!detail || !jump || jumpHandled.current === jump) return;
    jumpHandled.current = jump;
    locate(jump);
  }, [id, !!detail, jump]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const term = findQuery.trim();
    if (!findOpen || !term) { setFindHits([]); setFindIndex(0); setFindBusy(false); return; }
    let live = true;
    setFindBusy(true);
    const timeout = setTimeout(() => request(`sessions/${encodeURIComponent(id)}/find?q=${encodeURIComponent(term)}`)
      .then((hits) => { if (live) { setFindHits(hits); setFindIndex(0); } })
      .catch((e) => { if (live) setError(e.message); })
      .finally(() => { if (live) setFindBusy(false); }), 250);
    return () => { live = false; clearTimeout(timeout); };
  }, [id, findOpen, findQuery]);
  useEffect(() => {
    if (findOpen && findHits.length) locate(findHits[findIndex]?.messageId);
  }, [findHits, findIndex, findOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const stepFind = (delta) => { if (findHits.length) setFindIndex((i) => (i + delta + findHits.length) % findHits.length); };
  const closeFind = () => { setFindOpen(false); setFindQuery(''); setFindHits([]); setFindIndex(0); };

  const older = async () => {
    if (!detail?.nextCursor || busy) return;
    const version = ++requestVersion.current;
    setBusy(true);
    const first = detail.messages[0]?.id;
    const before = scroller.current?.querySelector(`#message-${CSS.escape(first)}`)?.getBoundingClientRect().top;
    try {
      const page = await request(`sessions/${encodeURIComponent(id)}?cursor=${encodeURIComponent(detail.nextCursor)}`);
      if (version !== requestVersion.current || id !== currentId.current) return;
      prependAnchor.current = { id: first, top: before };
      setDetail((old) => ({ ...old, messages: [...page.messages, ...old.messages], hasMore: page.hasMore, nextCursor: page.nextCursor }));
    } catch (e) { if (version === requestVersion.current && id === currentId.current) setError(e.message); }
    finally { if (version === requestVersion.current && id === currentId.current) setBusy(false); }
  };
  if (error && !detail) return <div className="reader-empty">读取失败：{error}<button onClick={onBack}>返回</button></div>;
  if (!detail) return <div className="reader-empty">正在载入会话…</div>;
  const activeFindMessageId = findOpen && findHits.length ? findHits[findIndex]?.messageId : null;
  const activeFindTerm = findOpen ? findQuery.trim() : '';
  const questionsFilter = questionsOnly && !findOpen;
  return <div className="selected-reader">
    <div className="session-properties">
      <div className="eyebrow">{session ? '会话管理' : '会话工具'}</div>
      {session && <div className="session-property-fields">
        <Editor title="会话标题 · 写入 opencode" value={session.title} onSave={onRename} />
        <button type="button" className="session-info-trigger" onClick={() => setInfoOpen(true)} aria-haspopup="dialog"><span className="session-info-glyph" aria-hidden="true">✎</span>编辑会话信息</button>
      </div>}
      <div className="session-property-actions">
        <ActionHint text="隐藏思考、工具调用和中间回复，每次提问只显示最后一条有正文的回答"><button type="button" className={`qa-toggle${questionsOnly ? ' is-on' : ''}`} role="switch" aria-checked={questionsOnly} onClick={() => onQuestionsOnlyChange(!questionsOnly)}><span className="qa-toggle-track" aria-hidden="true" />仅问答</button></ActionHint>
        <ActionHint text="在当前会话的全部消息中查找关键词，支持上/下一处跳转"><button type="button" className={`find-toggle${findOpen ? ' is-on' : ''}`} aria-expanded={findOpen} onClick={() => (findOpen ? closeFind() : setFindOpen(true))}>查找</button></ActionHint>
        <ActionHint text={detail.resumeShell ? `复制命令，在 ${detail.resumeShell} 中继续这段会话` : '复制命令，在终端继续这段会话'}><CopyButton value={detail.resume} label="复制恢复命令" onNotify={onNotify} /></ActionHint>
        <ActionHint text={tocOpen ? '收起右侧提问目录，专注阅读会话' : '打开右侧提问目录，快速定位历史提问'}><button onClick={() => setTocOpen((v) => !v)} aria-expanded={tocOpen}>{tocOpen ? '收起' : '打开'}提问目录</button></ActionHint>
        {session && <ActionHint text="复制当前会话的 Session ID"><CopyButton className="id-copy" value={session.id} label="复制 Session ID ↗" onNotify={onNotify} /></ActionHint>}
      </div>
    </div>
    {session && infoOpen && createPortal(<SessionInfoDialog title={session.title} tags={session.tags || []} note={session.note} onClose={() => setInfoOpen(false)} onSave={async ({ title, tags, note }) => { if (title && title !== session.title) await onRename(title); await onMeta({ tags, note }); }} />, document.body)}
    {findOpen && <div className="find-bar" role="search">
      <input autoFocus className="find-input" aria-label="在当前会话中查找" placeholder="在当前会话中查找…" value={findQuery} onChange={(e) => setFindQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') closeFind(); }} />
      <span className="find-count" aria-live="polite">{findBusy ? '检索中…' : findQuery.trim() ? (findHits.length ? `${findIndex + 1} / ${findHits.length}` : '无匹配') : ''}</span>
      <button type="button" onClick={() => stepFind(-1)} disabled={!findHits.length} aria-label="上一处">▲</button>
      <button type="button" onClick={() => stepFind(1)} disabled={!findHits.length} aria-label="下一处">▼</button>
      <button type="button" className="find-close" onClick={closeFind} aria-label="关闭查找">✕</button>
    </div>}
    <div className="reading-layout">
    <article className="reader" ref={scroller}>
      <header className="reader-head">
        <button className="icon-button mobile-back" onClick={onBack} aria-label="返回列表"><Icon name="back" /></button>
        <div className="eyebrow">会话档案 <span> / {age(detail.messages.at(-1)?.createdAt)}</span></div>
        <h1>{detail.title}</h1>
        <div className="reader-path" title={detail.directory}>{detail.directory}</div>
      </header>
      {error && <p className="inline-error">{error}</p>}
      {detail.jumped && <button className="older" onClick={async () => { const version = ++requestVersion.current; pendingAnchor.current = null; prependAnchor.current = null; setBusy(true); try { const page = await request(`sessions/${encodeURIComponent(id)}`); if (version !== requestVersion.current || id !== currentId.current) return; pendingTop.current = true; setDetail(page); } catch (e) { if (version === requestVersion.current && id === currentId.current) setError(e.message); } finally { if (version === requestVersion.current && id === currentId.current) setBusy(false); } }} disabled={busy}>回到最新消息</button>}
      {detail.hasMore && <button className="older" onClick={older} disabled={busy}>{busy ? '加载中…' : '↑ 加载更早的消息'}</button>}
      <div className="transcript">{detail.messages.map((msg) => {
        const parts = questionsFilter ? msg.parts.filter((part) => part.type !== 'tool' && part.type !== 'reasoning') : msg.parts;
        if (questionsFilter && msg.role !== 'user' && !msg.finalAnswer) return null;
        return <section className={`message ${msg.role}${msg.id === activeFindMessageId ? ' is-find-active' : ''}`} id={`message-${msg.id}`} key={msg.id}>
        <div className="message-label">{msg.role === 'user' ? '你' : 'opencode'} <time>{new Date(msg.createdAt).toLocaleString('zh-CN')}</time></div>
        <div className="message-body">{parts.length ? parts.map((part, index) => <Part key={index} part={part} findTerm={activeFindTerm} />) : <span className="muted">无可显示内容</span>}</div>
      </section>})}</div>
      <div className="endnote">{detail.jumped ? '已定位到历史消息 · 可返回最新消息' : '会话内容已显示至最新'} · 只读档案</div>
    </article>
    {tocOpen && <QuestionKeys key={id} items={toc} activeId={activeQuestion} onLocate={locate} />}
    </div>
  </div>;
}

function Editor({ title, value, onSave, placeholder = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { setDraft(value || ''); }, [value]);
  return <div className="editor"><div className="editor-label">{title}</div>{editing ? <div className="editor-form"><input autoFocus value={draft} maxLength={120} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { onSave(draft); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} /><button onClick={() => { onSave(draft); setEditing(false); }}>保存</button><button onClick={() => setEditing(false)}>取消</button></div> : <button className="editor-value" onClick={() => setEditing(true)}>{value || placeholder || '点击编辑'} <span>✎</span></button>}</div>;
}

// Secondary dialog for title + tags + note (title also has an inline quick-edit in the bar).
function SessionInfoDialog({ title, tags, note, onSave, onClose }) {
  const [titleDraft, setTitleDraft] = useState(title || '');
  const [tagDraft, setTagDraft] = useState((tags || []).join(', '));
  const [noteDraft, setNoteDraft] = useState(note || '');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, [onClose]);
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave({ title: titleDraft.trim(), tags: tagDraft.split(/[,，]/).map((t) => t.trim()).filter(Boolean), note: noteDraft.trim() });
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-panel" role="dialog" aria-modal="true" aria-label="编辑会话信息">
      <div className="dialog-head">
        <div className="dialog-eyebrow">会话信息</div>
        <h2>编辑会话信息</h2>
        <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭">✕</button>
      </div>
      <label className="dialog-field">
        <span className="dialog-label">标题 <small>写入 opencode</small></span>
        <input autoFocus value={titleDraft} placeholder="会话标题" maxLength={120} onChange={(e) => setTitleDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
      </label>
      <label className="dialog-field">
        <span className="dialog-label">标签 <small>用逗号分隔，最多 12 个</small></span>
        <input value={tagDraft} placeholder="例如：工作, 复盘, 待跟进" maxLength={200} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
      </label>
      <label className="dialog-field">
        <span className="dialog-label">备注</span>
        <textarea value={noteDraft} placeholder="为这段会话留一条备注…" rows={4} maxLength={2000} onChange={(e) => setNoteDraft(e.target.value)} />
      </label>
      <div className="dialog-foot">
        <button type="button" className="dialog-btn" onClick={onClose} disabled={saving}>取消</button>
        <button type="button" className="dialog-btn primary" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
      </div>
    </div>
  </div>;
}

export default function App() {
  const [url, setUrl] = useState(current);
  const [index, setIndex] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [projectFilter, setProjectFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [directoryFilter, setDirectoryFilter] = useState('');
  const [sort, setSort] = useState('recent');
  const [drawer, setDrawer] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() => localStorage.getItem('ocde.railCollapsed') === 'true');
  const [questionsOnly, setQuestionsOnly] = useState(() => localStorage.getItem('ocde.questionsOnly') === 'true');
  const [toast, setToast] = useState(null);
  const [projectPage, setProjectPage] = useState({ id: '', items: [], total: 0, cursor: 0, hasMore: false, loading: false });
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const notify = (message, failed = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, failed });
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };
  const load = useCallback(async () => {
    setRefreshing(true);
    try { setIndex(await request('index')); setError(''); } catch (e) { setError(e.message); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const pop = () => setUrl(current()); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  const go = (path) => { history.pushState(null, '', path); setUrl(current()); setDrawer(false); window.scrollTo(0, 0); };
  const toggleRail = () => {
    const next = !railCollapsed;
    setRailCollapsed(next);
    localStorage.setItem('ocde.railCollapsed', String(next));
  };
  const toggleQuestionsOnly = (next) => {
    setQuestionsOnly(next);
    localStorage.setItem('ocde.questionsOnly', String(next));
  };
  const parts = url.split('?')[0].split('/').filter(Boolean);
  const section = parts[0] || 'projects';
  const projectId = section === 'projects' && parts[1] ? decodeURIComponent(parts[1]) : '';
  const selectedId = section === 'projects' && parts[2] === 'sessions' ? parts[3] : section === 'all' && parts[1] === 'sessions' ? parts[2] : '';
  const jump = new URLSearchParams(url.split('?')[1] || '').get('message');
  const q = new URLSearchParams(url.split('?')[1] || '').get('q') || '';
  const scope = new URLSearchParams(url.split('?')[1] || '').get('scope') || 'all';
  const [query, setQuery] = useState(q);
  useEffect(() => { setQuery(q); }, [q]);
  const allHref = (nextQ, nextScope) => {
    const params = new URLSearchParams();
    if (nextQ) params.set('q', nextQ);
    if (nextScope && nextScope !== 'all') params.set('scope', nextScope);
    const search = params.toString();
    return '/all' + (search ? `?${search}` : '');
  };
  const changeScope = (next) => { history.replaceState(null, '', allHref(q, next)); setUrl(current()); };
  useEffect(() => {
    if (section !== 'all' || selectedId || !q.trim()) { setResults(null); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const timeout = setTimeout(() => request(`search?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scope)}`).then((r) => { if (live) setResults({ ...r, query: q, scope }); }).catch((e) => { if (live) setError(e.message); }).finally(() => { if (live) setSearching(false); }), 250);
    return () => { live = false; clearTimeout(timeout); };
  }, [section, selectedId, q, scope]);
  useEffect(() => {
    if (!projectId) { setProjectPage({ id: '', items: [], total: 0, cursor: 0, hasMore: false, loading: false }); return; }
    let live = true;
    setProjectPage({ id: projectId, items: [], total: 0, cursor: 0, hasMore: false, loading: true });
    const params = new URLSearchParams({ limit: '30', sort, directory: directoryFilter, q: sessionFilter });
    const timeout = setTimeout(() => request(`projects/${encodeURIComponent(projectId)}/sessions?${params}`)
      .then((r) => { if (live) setProjectPage({ id: projectId, items: r.sessions, total: r.total, cursor: r.nextCursor || r.sessions.length, hasMore: r.hasMore, loading: false }); })
      .catch((e) => { if (live) { setError(e.message); setProjectPage((p) => ({ ...p, loading: false })); } }), 200);
    return () => { live = false; clearTimeout(timeout); };
  }, [projectId, sort, sessionFilter, directoryFilter]);
  const loadMoreSessions = async () => {
    if (!projectPage.hasMore || projectPage.loading) return;
    setProjectPage((p) => ({ ...p, loading: true }));
    const params = new URLSearchParams({ limit: '30', sort, directory: directoryFilter, q: sessionFilter, cursor: String(projectPage.cursor) });
    try {
      const r = await request(`projects/${encodeURIComponent(projectPage.id)}/sessions?${params}`);
      setProjectPage((p) => ({ ...p, items: [...p.items, ...r.sessions], total: r.total, cursor: r.nextCursor || (p.items.length + r.sessions.length), hasMore: r.hasMore, loading: false }));
    } catch (e) { setError(e.message); setProjectPage((p) => ({ ...p, loading: false })); }
  };
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' || e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault(); go('/all'); setTimeout(() => document.querySelector('.global-search')?.focus(), 0);
      }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
  const projects = index?.projects || [];
  const sessions = index?.sessions || [];
  const project = projects.find((p) => p.id === projectId);
  const selected = sessions.find((s) => s.id === selectedId);
  const visibleProjects = projects.filter((p) => `${projectName(p)} ${p.paths.join(' ')}`.toLowerCase().includes(projectFilter.toLowerCase()));
  const meta = async (kind, id, patch) => {
    const isSessionPin = kind === 'sessions' && Object.prototype.hasOwnProperty.call(patch, 'pinned');
    const previousPageItems = isSessionPin ? projectPage.items : null;
    if (isSessionPin) {
      setProjectPage((page) => ({ ...page, items: page.items.map((s) => s.id === id ? { ...s, pinned: patch.pinned } : s) }));
    }
    try {
      await request(`meta/${kind}/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      await load();
    } catch (e) {
      if (isSessionPin) setProjectPage((page) => ({ ...page, items: previousPageItems }));
      setError(e.message);
    }
  };
  // Throwing here lets usePinnedOrder roll back its optimistic state.
  const reorder = async (kind, ids) => {
    await request('meta/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ids }) });
    await load();
  };
  const reduceMotion = useReducedMotion();
  const layoutTransition = reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42 };
  const dragFeedback = reduceMotion ? undefined : { scale: 1.02, boxShadow: '0 8px 22px rgba(0, 0, 0, 0.14)', opacity: 1 };
  const stopDrag = (e) => e.stopPropagation();
  const [orderedProjects, commitProjects, previewProjects, beginProjectDrag, finishProjectDrag, beginProjectPointer, guardProjectClick, savingProjects] = usePinnedOrder(projects.filter((p) => p.pinned), (ids) => reorder('projects', ids), (e) => setError(e.message));
  const [orderedPinnedSessions, commitPinnedSessions, previewSessions, beginSessionDrag, finishSessionDrag, beginSessionPointer, guardSessionClick, savingSessions] = usePinnedOrder(projectPage.items.filter((s) => s.pinned), (ids) => reorder('sessions', ids), (e) => setError(e.message));
  const moveBy = (list, commit, id, delta) => {
    const ids = list.map((item) => item.id);
    const from = ids.indexOf(id);
    commit(moveId(ids, from, from + delta));
  };
  const sessionRowBody = (s) => <>
    <button className="session-target" onPointerDownCapture={beginSessionPointer} onClick={(e) => { if (guardSessionClick(e)) { e.preventDefault(); e.stopPropagation(); return; } go(`/projects/${encodeURIComponent(project.id)}/sessions/${encodeURIComponent(s.id)}`); }}><strong>{s.pinned ? '★ ' : ''}{s.title}</strong>{s.firstQuestion && <span className="session-preview">{short(s.firstQuestion, 96)}</span>}<span className="session-sub">{age(s.lastActivity)} <span>·</span> {s.messageCount} 条消息</span>{s.tags?.length > 0 && <small className="session-dir">{s.tags.join(' · ')}</small>}{project.paths.length > 1 && <small className="session-dir">{s.directory}</small>}</button>
    {s.pinned && orderedPinnedSessions.length > 1 && <div className="session-order" onPointerDownCapture={stopDrag}><button type="button" onClick={() => moveBy(orderedPinnedSessions, commitPinnedSessions, s.id, -1)} disabled={savingSessions || orderedPinnedSessions[0]?.id === s.id} aria-label="上移会话">↑</button><button type="button" onClick={() => moveBy(orderedPinnedSessions, commitPinnedSessions, s.id, 1)} disabled={savingSessions || orderedPinnedSessions[orderedPinnedSessions.length - 1]?.id === s.id} aria-label="下移会话">↓</button></div>}
    <button className="session-pin" onPointerDownCapture={stopDrag} onClick={() => meta('sessions', s.id, { pinned: !s.pinned })} title={s.pinned ? '取消置顶' : '置顶会话'} aria-label={s.pinned ? '取消置顶' : '置顶会话'}>{s.pinned ? '★' : '☆'}</button>
  </>;
  const rename = async (id, title) => {
    if (!title.trim()) return;
    try {
      await request(`sessions/${encodeURIComponent(id)}/title`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      await load();
      setUrl(current());
    } catch (e) { setError(e.message); }
  };
  const open = (path) => fetch('/api/open?path=' + encodeURIComponent(path)).then((r) => { if (!r.ok) throw Error('无法打开目录'); }).catch((e) => setError(e.message));
  return <div className="app-shell">
    <nav className={`rail ${railCollapsed ? 'collapsed' : 'expanded'} ${drawer ? 'show' : ''}`} aria-label="主导航">
      <div className="brand"><div className="brand-mark"><img src="/icon-64.png" alt="" /></div><div className="brand-name"><strong>dialog explorer</strong><small>opencode archive</small></div><button className="rail-toggle" onClick={toggleRail} title={railCollapsed ? '展开侧栏' : '收起侧栏'} aria-label={railCollapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!railCollapsed}><Icon name="panel" /></button></div>
      <div className="nav-group-label">工作空间</div>
      <button className={`nav-link ${section === 'projects' ? 'active' : ''}`} onClick={() => go('/projects')} title="项目" aria-label="项目"><Icon name="folder" /><span className="nav-text">项目</span><span className="nav-count">{projects.length}</span></button>
      <button className={`nav-link ${section === 'all' ? 'active' : ''}`} onClick={() => go('/all')} title="全部记录" aria-label="全部记录"><Icon name="search" /><span className="nav-text">全部记录</span></button>
      <button className={`nav-link ${section === 'pinned' ? 'active' : ''}`} onClick={() => go('/pinned')} title="已置顶" aria-label="已置顶"><Icon name="pin" /><span className="nav-text">已置顶</span></button>
      <div className="nav-group-label section-gap">最近项目</div>
      <div className="project-nav">{projects.slice(0, 9).map((p) => <motion.button layout={!reduceMotion && 'position'} transition={layoutTransition} key={p.id} className={projectId === p.id ? 'current' : ''} onClick={() => go(`/projects/${encodeURIComponent(p.id)}`)} title={p.paths.join('\n')} aria-label={`${projectName(p)}${p.pinned ? '，已置顶' : ''}`}><span className="nav-folder">▤</span><span className="project-nav-name">{projectName(p)}</span>{p.pinned && <span className="project-nav-pin" aria-hidden="true"><Icon name="pin" /></span>}</motion.button>)}</div>
      <div className="rail-footer"><span className="status-dot" /> 本机档案 <small>只读浏览 · 端口 4570</small></div>
    </nav>
    <div className="workspace">
      {toast && <div className={`copy-toast${toast.failed ? ' failed' : ''}`} role="status">{toast.failed ? '!' : '✓'} {toast.message}</div>}
      <div className="workspace-bar"><button className="icon-button mobile-menu" onClick={() => setDrawer(!drawer)} aria-label="打开导航">☰</button><span className="breadcrumb">档案 <span>/</span> {section === 'all' ? '全部记录' : section === 'pinned' ? '已置顶' : project ? projectName(project) : '项目'}</span><div className="workspace-actions"><span className="desktop-hint">本地 · {sessions.length} 个会话</span><button className="icon-button" onClick={load} disabled={refreshing} title="手动刷新" aria-label="手动刷新"><Icon name="refresh" /></button></div></div>
      {error && <div className="notice" role="alert">{error}<button onClick={() => setError('')}>关闭</button></div>}
      {!index && !error && <div className="loading">正在整理本地档案…</div>}
      {index && section === 'projects' && !projectId && <main className="overview">
        <div className="eyebrow">YOUR WORKSPACE / 本地工作档案</div><h1>从项目开始。</h1><p className="lead">对话不再散落在一个长列表里。选择项目，回到当时工作的上下文。</p>
        <div className="overview-stats"><div><strong>{projects.length}</strong><span>个项目</span></div><div><strong>{sessions.length}</strong><span>段对话</span></div><div><strong>{new Set(sessions.map((s) => s.directory)).size}</strong><span>个工作路径</span></div></div>
        <div className="overview-heading"><h2>项目</h2><input placeholder="查找项目或路径…" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="查找项目" /></div>
        <div className="project-grid">{visibleProjects.map((p, i) => <button key={p.id} className="project-card" onClick={() => go(`/projects/${encodeURIComponent(p.id)}`)}><div className="project-card-top"><span className="project-glyph">{String(i + 1).padStart(2, '0')}</span>{p.pinned && <span className="pinned-flag">置顶</span>}<Icon name="chevron" /></div><h3>{projectName(p)}</h3><div className="project-location" title={p.paths.join('\n')}>{p.paths[0] || p.worktree || '未记录路径'}</div><div className="project-card-foot"><span>{p.sessionCount} 个会话 · {p.paths.length} 个路径</span><time>{age(p.lastActivity)}</time></div></button>)}</div>
        {!projects.length && <div className="reader-empty">没有找到 opencode 历史会话。请检查本机的 opencode 数据库。</div>}
      </main>}
      {index && section === 'projects' && projectId && !project && <div className="reader-empty">这个项目已不在本机档案中。<button onClick={() => go('/projects')}>返回项目</button></div>}
      {index && project && <div className={`project-view ${selectedId ? 'has-selection' : ''}`}>
        <aside className="session-panel">
          <div className="session-heading"><div className="session-heading-top"><button className="text-back" onClick={() => go('/projects')}>← 所有项目</button><div className="project-tools"><ActionHint text={project.pinned ? '取消置顶项目' : '置顶项目，方便快速找到'}><button onClick={() => meta('projects', project.id, { pinned: !project.pinned })}>{project.pinned ? '★ 已置顶' : '☆ 置顶项目'}</button></ActionHint><ActionHint text="尝试在文件管理器中打开项目工作目录"><button onClick={() => open(project.paths[0])}>打开目录</button></ActionHint></div></div><div className="eyebrow">项目档案</div><h2>{projectName(project)}</h2><div className="project-identity" title={project.paths.join('\n')}>{project.paths[0] || project.worktree}</div><Editor title="项目别名" value={project.alias} placeholder="添加别名" onSave={(alias) => meta('projects', project.id, { alias })} /><Editor title="项目备注" value={project.note} placeholder="添加备注" onSave={(note) => meta('projects', project.id, { note })} /></div>
          <div className="sessions-title">
            <div className="sessions-title-row"><span>会话 <small>{projectPage.total}</small></span><select aria-label="会话排序" value={sort} onChange={(e) => setSort(e.target.value)}><option value="recent">最近</option><option value="oldest">最早</option><option value="messages">消息数</option><option value="title">标题</option></select></div>
            <div className="sessions-filters"><input className="session-filter" aria-label="按会话名称筛选" placeholder="筛选会话…" value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)} />{project.paths.length > 1 && <select className="directory-filter" aria-label="按工作路径筛选" title={directoryFilter || '所有工作路径'} value={directoryFilter} onChange={(e) => setDirectoryFilter(e.target.value)}><option value="">所有工作路径</option>{project.paths.map((p) => <option key={p} value={p}>{p}</option>)}</select>}</div>
          </div>
          <motion.div className="session-scroll" layoutScroll>
            {orderedPinnedSessions.length > 0 && <Reorder.Group as="div" axis="y" className="session-pinned-group" values={orderedPinnedSessions.map((s) => s.id)} onReorder={previewSessions}>{orderedPinnedSessions.map((s) => <Reorder.Item as="div" key={s.id} value={s.id} drag={savingSessions ? false : 'y'} onDragStart={beginSessionDrag} onDragEnd={finishSessionDrag} layout={!reduceMotion} transition={layoutTransition} whileDrag={dragFeedback} className={`session-item pinned-item ${s.id === selectedId ? 'selected' : ''}`}>{sessionRowBody(s)}</Reorder.Item>)}</Reorder.Group>}
            {projectPage.items.filter((s) => !s.pinned).map((s) => <div key={s.id} className={`session-item ${s.id === selectedId ? 'selected' : ''}`}>{sessionRowBody(s)}</div>)}
          </motion.div>
          {projectPage.loading && !projectPage.items.length && <div className="session-empty">正在载入会话…</div>}
          {!projectPage.loading && !projectPage.items.length && <div className="session-empty">没有匹配的会话。</div>}
          {projectPage.hasMore && <button className="session-more" onClick={loadMoreSessions} disabled={projectPage.loading}>{projectPage.loading ? '加载中…' : `加载更多（还有 ${projectPage.total - projectPage.items.length} 段）`}</button>}
        </aside>
        {selectedId && selected ? <Reader key={`${selected.id}:${selected.title}`} id={selected.id} jump={jump} session={selected} onRename={(title) => rename(selected.id, title)} onMeta={(patch) => meta('sessions', selected.id, patch)} onBack={() => go(`/projects/${encodeURIComponent(project.id)}`)} onNotify={notify} questionsOnly={questionsOnly} onQuestionsOnlyChange={toggleQuestionsOnly} /> : <div className="project-placeholder"><div className="placeholder-symbol">⌁</div><div className="eyebrow">PROJECT ARCHIVE</div><h2>把上下文找回来。</h2><p>从左侧选择一段对话，查看提问、回复和操作过程。</p><div>{project.sessionCount} 段会话分布在 {project.paths.length} 个工作路径中</div></div>}
      </div>}
      {index && section === 'all' && selectedId && selected && <Reader id={selected.id} jump={jump} session={selected} onRename={(title) => rename(selected.id, title)} onMeta={(patch) => meta('sessions', selected.id, patch)} onBack={() => go(allHref(q, scope))} onNotify={notify} questionsOnly={questionsOnly} onQuestionsOnlyChange={toggleQuestionsOnly} />}
       {index && section === 'all' && !selectedId && <main className="all-page"><div className="eyebrow">DISCOVERY / 跨项目找回</div><h1>全部记录</h1><p className="lead">不记得在哪个项目？从标题、路径或历史消息中找回线索。</p><div className={`global-search-wrap ${q.trim() && (searching || results?.query !== q || results?.scope !== scope) ? 'is-searching' : ''}`}><Icon name="search" /><input className="global-search" aria-label="搜索全部记录" placeholder="搜索项目、会话或消息正文…" value={query} onChange={(e) => { const next = e.target.value; setQuery(next); setResults(null); setSearching(!!next.trim()); history.replaceState(null, '', allHref(next, scope)); setUrl(current()); }} /><kbd>⌘ K</kbd></div>{q.trim() && <div className="search-scope" role="group" aria-label="搜索范围">{SCOPES.map(([value, label]) => <button key={value} className={scope === value ? 'is-on' : ''} aria-pressed={scope === value} onClick={() => changeScope(value)}>{label}</button>)}</div>}{q.trim() && (searching || results?.query !== q || results?.scope !== scope) && !error && <div className="search-progress" role="status"><span className="search-spinner" aria-hidden="true" />正在检索所有历史消息<span className="search-dots" aria-hidden="true">…</span></div>}{q.trim() && !searching && results?.query === q && results?.scope === scope && <><div className="results-heading" role="status">{results.total} 处匹配{results.truncated ? '（已截断，请缩小范围）' : ''}</div><div className="result-list">{results.results.map((r) => <button key={`${r.sessionId}:${r.messageId || r.matchField}`} onClick={() => go(`/all/sessions/${encodeURIComponent(r.sessionId)}?${new URLSearchParams({ q, scope, ...(r.messageId ? { message: r.messageId } : {}) })}`)}><div className="result-kind"><Highlight text={r.projectName} query={q} /> <span>/ {matchLabel[r.matchField] || '命中'}</span></div><strong><Highlight text={r.title} query={q} /></strong><p><Highlight text={short(r.snippet, 200)} query={q} /></p><time>{age(r.updatedAt)}</time></button>)}</div>{results.hasMore && <div className="search-status">当前仅展示前 {results.results.length} 处，请缩小关键词或范围。</div>}</>}{!q.trim() && <><div className="overview-heading"><h2>路径索引</h2><span>{new Set(sessions.map((s) => s.directory)).size} 个工作路径</span></div><div className="path-index">{projects.map((p) => <div key={p.id}><h3 onClick={() => go(`/projects/${encodeURIComponent(p.id)}`)}>{projectName(p)} <Icon name="chevron" /></h3>{p.paths.map((path) => <div key={path} title={path}>{path}</div>)}</div>)}</div></>}</main>}
      {index && section === 'pinned' && (() => {
        const rank = new Map(projects.map((p, i) => [p.id, i]));
        const pinnedSessions = sessions.filter((s) => s.pinned).sort((a, b) => {
          const pa = rank.get(a.projectId) ?? 1e9;
          const pb = rank.get(b.projectId) ?? 1e9;
          if (pa !== pb) return pa - pb;
          const ao = Number.isInteger(a.order) ? a.order : Infinity;
          const bo = Number.isInteger(b.order) ? b.order : Infinity;
          return ao - bo || (b.lastActivity || '').localeCompare(a.lastActivity || '');
        });
        return <main className="all-page"><div className="eyebrow">SHORTLIST / 快速回到重要工作</div><h1>已置顶</h1>
          <div className="overview-heading"><h2>项目</h2>{orderedProjects.length > 1 && <span className="reorder-hint">用 ↑ ↓ 调整顺序，或直接拖动</span>}</div>
          <Reorder.Group as="div" axis="y" className="pinned-list pinned-projects" values={orderedProjects.map((p) => p.id)} onReorder={previewProjects}>{orderedProjects.map((p, i) => <Reorder.Item as="div" key={p.id} value={p.id} drag={savingProjects ? false : 'y'} onDragStart={beginProjectDrag} onDragEnd={finishProjectDrag} layout={!reduceMotion} transition={layoutTransition} whileDrag={dragFeedback} className="pinned-row"><button className="pinned-open" onPointerDownCapture={beginProjectPointer} onClick={(e) => { if (guardProjectClick(e)) { e.preventDefault(); e.stopPropagation(); return; } go(`/projects/${encodeURIComponent(p.id)}`); }}>▤　{projectName(p)} <span>{p.sessionCount} 个会话</span></button><div className="reorder-buttons" onPointerDownCapture={stopDrag}><button type="button" onClick={() => moveBy(orderedProjects, commitProjects, p.id, -1)} disabled={savingProjects || i === 0} aria-label="上移项目">↑</button><button type="button" onClick={() => moveBy(orderedProjects, commitProjects, p.id, 1)} disabled={savingProjects || i === orderedProjects.length - 1} aria-label="下移项目">↓</button></div></Reorder.Item>)}</Reorder.Group>
          {!orderedProjects.length && <div className="reader-empty">还没有置顶的项目。</div>}
          <div className="overview-heading"><h2>会话</h2></div>
          <div className="pinned-list">{pinnedSessions.map((s) => <motion.div layout={!reduceMotion && 'position'} transition={layoutTransition} key={s.id} className="pinned-row"><button className="pinned-open" onClick={() => go(`/projects/${encodeURIComponent(s.projectId)}/sessions/${encodeURIComponent(s.id)}`)}>{s.title}<span>{projectName(projects.find((p) => p.id === s.projectId))}</span></button></motion.div>)}</div>
          {!pinnedSessions.length && <div className="reader-empty">还没有置顶的会话。</div>}
        </main>;
      })()}
    </div>
  </div>;
}
