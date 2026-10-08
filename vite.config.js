import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { listConversations, getConversation, SOURCE_META } from './server/sources/index.js';
import { openPath } from './server/open.js';
import { searchContent, warmIndex } from './server/search.js';
import { archiveIndex, sessionMessages, questionToc, aroundMessage, archiveSearch } from './server/archive.js';
import { updateMeta } from './server/meta.js';
import { renameSession } from './server/rename.js';

// API that reads local transcripts from every supported AI coding tool and
// serves a unified list. Registered on BOTH the dev server and the preview
// server, so a built `dist/` is fully functional via `npm run preview`.
async function apiMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname.split('/').filter(Boolean);
  const json = (code, body) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  if (url.pathname.startsWith('/api/archive/')) {
    try {
      if (route[2] === 'sessions' && route[3] && route[4] === 'title' && req.method === 'PATCH') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1024) throw new Error('request too large');
        }
        return json(200, renameSession(decodeURIComponent(route[3]), JSON.parse(body).title));
      }
      if (url.pathname === '/api/archive/index' && req.method === 'GET') return json(200, archiveIndex());
      if (url.pathname === '/api/archive/search' && req.method === 'GET') return json(200, archiveSearch(url.searchParams.get('q'), {
        project: url.searchParams.get('project') || '', scope: url.searchParams.get('scope') || 'all',
      }));
      if (route[2] === 'sessions' && route[3] && req.method === 'GET') {
        const id = decodeURIComponent(route[3]);
        if (route[4] === 'toc') return json(200, questionToc(id));
        if (route[4] === 'around') return json(200, aroundMessage(id, url.searchParams.get('messageId')));
        if (!route[4]) return json(200, sessionMessages(id, { cursor: url.searchParams.get('cursor'), limit: url.searchParams.get('limit') }));
      }
      if (route[2] === 'meta' && ['projects', 'sessions'].includes(route[3]) && route[4] && req.method === 'PUT') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 8192) throw new Error('request too large');
        }
        return json(200, await updateMeta(route[3], decodeURIComponent(route[4]), JSON.parse(body)));
      }
      return json(404, { error: 'not found' });
    } catch (e) {
      return json(e.message.includes('not found') ? 404 : 400, { error: e.message });
    }
  }

  if (url.pathname === '/api/sources') {
    return json(200, SOURCE_META);
  }

  if (url.pathname === '/api/open') {
    const p = url.searchParams.get('path');
    try { json(200, openPath(p)); }
    catch (e) { json(400, { error: String(e) }); }
    return;
  }

  if (url.pathname === '/api/search') {
    const q = url.searchParams.get('q') || '';
    try { json(200, await searchContent(q)); }
    catch (e) { json(500, { error: String(e) }); }
    return;
  }

  if (url.pathname === '/api/conversations') {
    try { json(200, await listConversations()); }
    catch (e) { json(500, { error: String(e) }); }
    return;
  }

  if (url.pathname === '/api/conversation') {
    const source = url.searchParams.get('source');
    const ref = url.searchParams.get('ref');
    if (!source || !ref) return json(400, { error: 'missing source or ref' });
    try { json(200, await getConversation(source, ref, 30)); }
    catch (e) { json(e.message === 'forbidden' ? 403 : 500, { error: String(e) }); }
    return;
  }

  next();
}

function conversationsApi() {
  return {
    name: 'conversations-api',
    configureServer(server) { server.middlewares.use(apiMiddleware); warmIndex(); },
    configurePreviewServer(server) { server.middlewares.use(apiMiddleware); warmIndex(); },
  };
}

export default defineConfig({
  plugins: [react(), conversationsApi()],
  // localhost only — the API serves your private transcripts; never expose it
  // on the network (avoid `--host`).
  server: { port: 4570, open: true, host: 'localhost' },
  preview: { port: 4570, host: 'localhost' },
});
