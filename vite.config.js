import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { openPath } from './server/open.js';
import { archiveIndex, projectSessions, sessionMessages, questionToc, aroundMessage, findInSession, archiveSearch } from './server/archive.js';
import { updateMeta } from './server/meta.js';
import { renameSession } from './server/rename.js';

// API that reads local transcripts from the OpenCode SQLite database and serves
// the project-first archive. Registered on BOTH the dev server and the preview
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
        project: url.searchParams.get('project') || '',
        scope: url.searchParams.get('scope') || 'all',
        sort: url.searchParams.get('sort') || 'recent',
        cursor: url.searchParams.get('cursor') || 0,
        limit: url.searchParams.get('limit') || 50,
      }));
      if (route[2] === 'projects' && route[3] && route[4] === 'sessions' && req.method === 'GET') {
        return json(200, projectSessions(decodeURIComponent(route[3]), {
          cursor: url.searchParams.get('cursor') || 0,
          limit: url.searchParams.get('limit') || 30,
          sort: url.searchParams.get('sort') || 'recent',
          directory: url.searchParams.get('directory') || '',
          q: url.searchParams.get('q') || '',
        }));
      }
      if (route[2] === 'sessions' && route[3] && req.method === 'GET') {
        const id = decodeURIComponent(route[3]);
        if (route[4] === 'toc') return json(200, questionToc(id));
        if (route[4] === 'find') return json(200, findInSession(id, url.searchParams.get('q')));
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

  if (url.pathname === '/api/open') {
    const p = url.searchParams.get('path');
    try { json(200, openPath(p)); }
    catch (e) { json(400, { error: String(e) }); }
    return;
  }

  next();
}

function archiveApi() {
  return {
    name: 'archive-api',
    configureServer(server) { server.middlewares.use(apiMiddleware); },
    configurePreviewServer(server) { server.middlewares.use(apiMiddleware); },
  };
}

export default defineConfig({
  plugins: [react(), archiveApi()],
  // localhost only — the API serves your private transcripts; never expose it
  // on the network (avoid `--host`).
  server: { port: 4570, open: true, host: 'localhost' },
  preview: { port: 4570, host: 'localhost' },
});
