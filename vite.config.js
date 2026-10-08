import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { listConversations, getConversation, SOURCE_META } from './server/sources/index.js';
import { openPath } from './server/open.js';
import { searchContent, warmIndex } from './server/search.js';

// API that reads local transcripts from every supported AI coding tool and
// serves a unified list. Registered on BOTH the dev server and the preview
// server, so a built `dist/` is fully functional via `npm run preview`.
async function apiMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://localhost');
  const json = (code, body) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

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
